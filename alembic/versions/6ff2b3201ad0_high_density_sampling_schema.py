"""high_density_sampling_schema

Revision ID: 6ff2b3201ad0
Revises: fd7b3f33e9ab
Create Date: 2026-06-15 22:55:53.404791

支持节点高密采样（1s 本地采集 + 5s 心跳批量上传）：
- 7 个原有 JSON 列改 nullable —— 高密 sample 行只填列化数值，不重复填 JSON 元数据
- 新增 sample_gpus_json 列 —— 装高密多卡数组 [{idx, util, temp_c, vram_used_bytes}, ...]
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "6ff2b3201ad0"
down_revision: Union[str, Sequence[str], None] = "fd7b3f33e9ab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_JSON_COLUMNS = (
    "cpu_json",
    "memory_json",
    "disk_json",
    "gpu_json",
    "python_env_json",
    "task_runtime_json",
    "raw_payload_json",
)


def upgrade() -> None:
    """高密采样：JSON 列改 nullable + 加 sample_gpus_json 列。"""
    with op.batch_alter_table("node_status_snapshots") as batch_op:
        for col in _JSON_COLUMNS:
            batch_op.alter_column(col, existing_type=sa.Text(), nullable=True)
        batch_op.add_column(sa.Column("sample_gpus_json", sa.Text(), nullable=True))


def downgrade() -> None:
    """回滚：sample_gpus_json 列移除，JSON 列恢复 NOT NULL。

    注意：恢复 NOT NULL 前要把 NULL 行先填默认值 '{}'，否则约束会失败。
    """
    op.execute(
        """
        UPDATE node_status_snapshots
        SET cpu_json = COALESCE(cpu_json, '{}'),
            memory_json = COALESCE(memory_json, '{}'),
            disk_json = COALESCE(disk_json, '{}'),
            gpu_json = COALESCE(gpu_json, '{}'),
            python_env_json = COALESCE(python_env_json, '{}'),
            task_runtime_json = COALESCE(task_runtime_json, '{}'),
            raw_payload_json = COALESCE(raw_payload_json, '{}')
        """
    )
    with op.batch_alter_table("node_status_snapshots") as batch_op:
        batch_op.drop_column("sample_gpus_json")
        for col in _JSON_COLUMNS:
            batch_op.alter_column(col, existing_type=sa.Text(), nullable=False)
