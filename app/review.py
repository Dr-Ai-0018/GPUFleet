"""
§1.5 Stage 1 - AI review module.

Uses an OpenAI-compatible streaming chat completion API to review risky tasks.
"""
from __future__ import annotations

import json
import time
from typing import Any

import httpx
from pydantic import BaseModel, Field

from app.config import Settings
from app.logging_config import get_logger

logger = get_logger(__name__)


class RiskFactor(BaseModel):
    category: str
    detail: str
    severity: str


class ReviewDecision(BaseModel):
    decision: str
    risk_score: float = 0.0
    risk_factors: list[RiskFactor] = Field(default_factory=list)
    reasoning: str = ""


class ReviewContext(BaseModel):
    task_type: str
    node_id: str
    node_type: str
    payload: dict[str, Any]
    workdir: str | None = None
    env: dict[str, str] = Field(default_factory=dict)
    requested_gpu_ids: list[int] = Field(default_factory=list)
    admin_username: str = ""
    node_os: str | None = None
    node_tags: list[str] = Field(default_factory=list)
    legacy_blacklist_match: str | None = None


REVIEW_SYSTEM_PROMPT = """你是 GPUFleet 安全审核引擎。你的任务是评估一条即将在远程 GPU 计算节点上执行的命令是否安全。

你需要从以下维度评估风险：
1. 系统破坏性：是否会删除关键文件、格式化磁盘、破坏操作系统
2. 权限升级：是否尝试 sudo、runas、setuid、修改 passwd 等提权操作
3. 数据外泄：是否将本地敏感数据通过网络发送到外部
4. 持久化后门：是否写入 crontab、systemd unit、注册表启动项等持久化入口
5. 资源滥用：是否 fork bomb、无限循环、恶意占满 CPU/RAM/磁盘
6. 加密勒索：是否批量加密本地文件

上下文中的 legacy_blacklist_match 字段是旧版关键词匹配的结果，仅供参考，不应作为唯一判断依据。

请严格按以下 JSON 格式输出，不要输出任何其他内容：
{
  "decision": "approve 或 reject 或 uncertain",
  "risk_score": 0.0到1.0的浮点数,
  "risk_factors": [
    {"category": "维度名称", "detail": "具体描述", "severity": "low或medium或high"}
  ],
  "reasoning": "一段中文说明，解释你的判断依据"
}"""


class LLMReviewer:
    def __init__(self, settings: Settings) -> None:
        self.base_url = settings.review_llm_base_url.rstrip("/")
        self.api_key = settings.review_llm_api_key
        self.model = settings.review_llm_model
        self.timeout = settings.review_llm_timeout_sec
        self.max_tokens = settings.review_llm_max_tokens
        self.temperature = settings.review_llm_temperature

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def review(self, context: ReviewContext) -> ReviewDecision:
        started = time.perf_counter()
        try:
            response_text = await self._stream_chat_completion(context)
            return self._parse_response(response_text)
        except httpx.TimeoutException:
            logger.warning("llm_review_timeout", timeout_sec=self.timeout)
            return ReviewDecision(
                decision="uncertain",
                risk_score=0.5,
                reasoning=f"AI 审核超时（{self.timeout}s），自动升级到人工审核",
            )
        except Exception:
            logger.exception("llm_review_failed")
            return ReviewDecision(
                decision="uncertain",
                risk_score=0.5,
                reasoning="AI 审核异常，自动升级到人工审核",
            )
        finally:
            try:
                from app import metrics as gm

                gm.REVIEW_LLM_DURATION_SECONDS.observe(time.perf_counter() - started)
            except Exception:
                logger.exception("review_llm_duration_metric_failed")

    async def _stream_chat_completion(self, context: ReviewContext) -> str:
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": REVIEW_SYSTEM_PROMPT},
                {"role": "user", "content": context.model_dump_json()},
            ],
            "stream": True,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }

        collected: list[str] = []
        async with httpx.AsyncClient(timeout=httpx.Timeout(self.timeout)) as client:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk["choices"][0]["delta"].get("content", "")
                        if delta:
                            collected.append(delta)
                    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                        continue
        return "".join(collected)

    def _parse_response(self, text: str) -> ReviewDecision:
        text = text.strip()
        json_start = text.find("{")
        json_end = text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            text = text[json_start:json_end]

        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            logger.warning("llm_review_non_json_response", preview=text[:200])
            return ReviewDecision(
                decision="uncertain",
                risk_score=0.5,
                reasoning="AI 返回格式异常，自动升级到人工审核",
            )

        decision = data.get("decision", "uncertain")
        if decision not in ("approve", "reject", "uncertain"):
            decision = "uncertain"

        risk_score = float(data.get("risk_score", 0.5))
        risk_score = max(0.0, min(1.0, risk_score))

        factors: list[RiskFactor] = []
        for factor in data.get("risk_factors", []):
            if isinstance(factor, dict):
                factors.append(
                    RiskFactor(
                        category=str(factor.get("category", "")),
                        detail=str(factor.get("detail", "")),
                        severity=str(factor.get("severity", "medium")),
                    )
                )

        return ReviewDecision(
            decision=decision,
            risk_score=risk_score,
            risk_factors=factors,
            reasoning=str(data.get("reasoning", "")),
        )
