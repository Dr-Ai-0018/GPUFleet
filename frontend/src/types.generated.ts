export interface paths {
    "/api/v1/admin/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Login */
        post: operations["login_api_v1_admin_login_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Refresh */
        post: operations["refresh_api_v1_admin_refresh_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Logout */
        post: operations["logout_api_v1_admin_logout_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Me */
        get: operations["me_api_v1_admin_me_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/dashboard/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Overview */
        get: operations["get_overview_api_v1_admin_dashboard_overview_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/nodes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Nodes */
        get: operations["list_nodes_api_v1_admin_nodes_get"];
        put?: never;
        /** Create Node */
        post: operations["create_node_api_v1_admin_nodes_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/nodes/{node_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Node */
        get: operations["get_node_api_v1_admin_nodes__node_id__get"];
        put?: never;
        post?: never;
        /** Delete Node */
        delete: operations["delete_node_api_v1_admin_nodes__node_id__delete"];
        options?: never;
        head?: never;
        /** Update Node */
        patch: operations["update_node_api_v1_admin_nodes__node_id__patch"];
        trace?: never;
    };
    "/api/v1/admin/nodes/{node_id}/onboarding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Node Onboarding */
        get: operations["get_node_onboarding_api_v1_admin_nodes__node_id__onboarding_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/nodes/{node_id}/onboarding/regenerate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Regenerate Node Onboarding */
        post: operations["regenerate_node_onboarding_api_v1_admin_nodes__node_id__onboarding_regenerate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/nodes/{node_id}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable Node */
        post: operations["disable_node_api_v1_admin_nodes__node_id__disable_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/nodes/{node_id}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enable Node */
        post: operations["enable_node_api_v1_admin_nodes__node_id__enable_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/nodes/{node_id}/reset-secret": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reset Node Secret */
        post: operations["reset_node_secret_api_v1_admin_nodes__node_id__reset_secret_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/nodes/{node_id}/refresh-fingerprint": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Refresh Fingerprint
         * @description 触发节点重采完整指纹 (CPU 型号 / GPU 详情 / 虚拟化 / 网络 / Python 环境等).
         *
         *     机制:
         *     - 把 node_id 加进 app.state.pending_fingerprint_refresh in-memory set;
         *     - 下次该节点心跳到达时, response.refresh_fingerprint=True;
         *     - 节点收到后异步重采, 下一次心跳带新指纹进库.
         *
         *     服务端重启时 pending 丢失, 但操作幂等 (set 性质 + 节点重采也幂等), 重试即可.
         *     单实例 DB 零改动. 多实例时换 redis/db.
         */
        post: operations["refresh_fingerprint_api_v1_admin_nodes__node_id__refresh_fingerprint_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/nodes/{node_id}/status/latest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Latest Status */
        get: operations["get_latest_status_api_v1_admin_nodes__node_id__status_latest_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/nodes/{node_id}/status/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Status History */
        get: operations["get_status_history_api_v1_admin_nodes__node_id__status_history_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/audit-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Audit Events */
        get: operations["list_audit_events_api_v1_admin_audit_events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/audits": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Audits Page */
        get: operations["list_audits_page_api_v1_admin_audits_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/security-warnings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Security Warnings */
        get: operations["list_security_warnings_api_v1_admin_security_warnings_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/warnings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Warnings Page */
        get: operations["list_warnings_page_api_v1_admin_warnings_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Tasks */
        get: operations["list_tasks_api_v1_admin_tasks_get"];
        put?: never;
        /** Create Task */
        post: operations["create_task_api_v1_admin_tasks_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{task_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Task */
        get: operations["get_task_api_v1_admin_tasks__task_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{task_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel Task */
        post: operations["cancel_task_api_v1_admin_tasks__task_id__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{task_id}/review/escalate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Escalate Review */
        post: operations["escalate_review_api_v1_admin_tasks__task_id__review_escalate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{task_id}/review/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve Review */
        post: operations["approve_review_api_v1_admin_tasks__task_id__review_approve_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{task_id}/review/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject Review */
        post: operations["reject_review_api_v1_admin_tasks__task_id__review_reject_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{task_id}/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Task Logs */
        get: operations["get_task_logs_api_v1_admin_tasks__task_id__logs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{task_id}/artifacts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Task Artifacts */
        get: operations["get_task_artifacts_api_v1_admin_tasks__task_id__artifacts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/alerts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Alerts */
        get: operations["list_alerts_api_v1_admin_alerts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/alerts/unread-count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Unread Count */
        get: operations["unread_count_api_v1_admin_alerts_unread_count_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/alerts/{alert_id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark Read */
        post: operations["mark_read_api_v1_admin_alerts__alert_id__read_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/node/heartbeat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Heartbeat */
        post: operations["heartbeat_api_v1_node_heartbeat_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/node/task-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Task Events */
        post: operations["task_events_api_v1_node_task_events_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/node/task-log-chunk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Task Log Chunk */
        post: operations["task_log_chunk_api_v1_node_task_log_chunk_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/node/task-result": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Task Result */
        post: operations["task_result_api_v1_node_task_result_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/node/artifact-upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Artifact Upload */
        post: operations["artifact_upload_api_v1_node_artifact_upload_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Root */
        get: operations["root__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/healthz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Healthz */
        get: operations["healthz_healthz_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/readyz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Readyz
         * @description Readiness probe: verifies database is reachable and schema is initialized.
         */
        get: operations["readyz_readyz_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/console/{path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Console Index */
        get: operations["console_index_console__path__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/console/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Console Index */
        get: operations["console_index_console__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/console": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Console Index */
        get: operations["console_index_console_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AdminProfile */
        AdminProfile: {
            /** Id */
            id: number;
            /** Username */
            username: string;
            /** Is Active */
            is_active: boolean;
            /** Last Login At */
            last_login_at: string | null;
        };
        /** AdminTaskArtifactView */
        AdminTaskArtifactView: {
            /** Artifact Name */
            artifact_name: string;
            /** Artifact Type */
            artifact_type: string;
            /** Content Type */
            content_type: string | null;
            /** Size Bytes */
            size_bytes: number;
            /** Storage Path */
            storage_path: string;
            /** Preview */
            preview?: {
                [key: string]: unknown;
            };
            /** Created At */
            created_at: string;
        };
        /** AdminTaskCreateRequest */
        AdminTaskCreateRequest: {
            /** Node Id */
            node_id: string;
            /**
             * Type
             * @enum {string}
             */
            type: "shell" | "python_script" | "health_check" | "git_pull" | "pip_install" | "download_file" | "upload_and_unpack" | "modal_command" | "file_mkdir" | "file_write" | "file_patch_text" | "file_move" | "file_delete" | "file_extract" | "file_preview";
            /** Payload */
            payload?: {
                [key: string]: unknown;
            };
            /** Task Id */
            task_id?: string | null;
            /**
             * Revision
             * @default 1
             */
            revision: number;
            /** Idempotency Key */
            idempotency_key?: string | null;
            /** Workdir */
            workdir?: string | null;
            /** Env */
            env?: {
                [key: string]: string;
            };
            /** Requested Gpu Ids */
            requested_gpu_ids?: number[];
            /** Timeout Sec */
            timeout_sec?: number | null;
            /**
             * Kill Grace Sec
             * @default 15
             */
            kill_grace_sec: number;
            /**
             * Danger Level
             * @default normal
             */
            danger_level: string;
        };
        /** AdminTaskDetail */
        AdminTaskDetail: {
            /** Task Id */
            task_id: string;
            /** Revision */
            revision: number;
            /** Node Id */
            node_id: string;
            /** Type */
            type: string;
            /** Status */
            status: string;
            /** Workdir */
            workdir: string | null;
            /** Requested Gpu Ids */
            requested_gpu_ids: number[];
            /** Timeout Sec */
            timeout_sec: number;
            /** Danger Level */
            danger_level: string;
            /** Created At */
            created_at: string;
            /** Claimed At */
            claimed_at: string | null;
            /** Started At */
            started_at: string | null;
            /** Finished At */
            finished_at: string | null;
            /** Idempotency Key */
            idempotency_key: string;
            /** Payload */
            payload: {
                [key: string]: unknown;
            };
            /** Env */
            env: {
                [key: string]: string;
            };
            /** Kill Grace Sec */
            kill_grace_sec: number;
            /** Logs */
            logs?: components["schemas"]["AdminTaskLogView"][];
            /** Artifacts */
            artifacts?: components["schemas"]["AdminTaskArtifactView"][];
            result?: components["schemas"]["AdminTaskResultSummary"] | null;
            /** Review Stage */
            review_stage?: number | null;
            /** Review Decision */
            review_decision?: string | null;
        };
        /** AdminTaskListItem */
        AdminTaskListItem: {
            /** Task Id */
            task_id: string;
            /** Revision */
            revision: number;
            /** Node Id */
            node_id: string;
            /** Type */
            type: string;
            /** Status */
            status: string;
            /** Workdir */
            workdir: string | null;
            /** Requested Gpu Ids */
            requested_gpu_ids: number[];
            /** Timeout Sec */
            timeout_sec: number;
            /** Danger Level */
            danger_level: string;
            /** Created At */
            created_at: string;
            /** Claimed At */
            claimed_at: string | null;
            /** Started At */
            started_at: string | null;
            /** Finished At */
            finished_at: string | null;
        };
        /** AdminTaskListPage */
        AdminTaskListPage: {
            /** Items */
            items: components["schemas"]["AdminTaskListItem"][];
            /** Next Cursor */
            next_cursor?: string | null;
            /** Total Estimate */
            total_estimate?: number | null;
        };
        /** AdminTaskLogView */
        AdminTaskLogView: {
            /**
             * Stream
             * @enum {string}
             */
            stream: "stdout" | "stderr";
            /** Last Offset */
            last_offset: number;
            /** Preview Text */
            preview_text: string;
            /** Center Log Path */
            center_log_path: string | null;
            /**
             * Is Truncated
             * @default false
             */
            is_truncated: boolean;
            /** Truncated Notice */
            truncated_notice?: string | null;
            /** Updated At */
            updated_at: string;
        };
        /** AdminTaskResultSummary */
        AdminTaskResultSummary: {
            /** Exit Code */
            exit_code: number | null;
            /** Summary */
            summary?: {
                [key: string]: unknown;
            };
            /** Finished At */
            finished_at: string | null;
        };
        /** AlertMessageView */
        AlertMessageView: {
            /** Id */
            id: number;
            /** Alert Type */
            alert_type: string;
            /** Severity */
            severity: string;
            /** Title */
            title: string;
            /** Summary */
            summary: string | null;
            /** Detail */
            detail?: {
                [key: string]: unknown;
            };
            /** Target Type */
            target_type: string | null;
            /** Target Id */
            target_id: string | null;
            /** Status */
            status: string;
            /** Actioned By */
            actioned_by: number | null;
            /** Actioned At */
            actioned_at: string | null;
            /** Expires At */
            expires_at: string | null;
            /** Created At */
            created_at: string;
        };
        /** AuditEventPage */
        AuditEventPage: {
            /** Items */
            items: components["schemas"]["AuditEventView"][];
            /** Next Cursor */
            next_cursor?: string | null;
            /** Total Estimate */
            total_estimate?: number | null;
        };
        /** AuditEventView */
        AuditEventView: {
            /** Id */
            id: number;
            /** Actor Type */
            actor_type: string;
            /** Actor Id */
            actor_id: string | null;
            /** Action */
            action: string;
            /** Target Type */
            target_type: string;
            /** Target Id */
            target_id: string | null;
            /** Request Ip */
            request_ip: string | null;
            /** Detail */
            detail: {
                [key: string]: unknown;
            };
            /** Created At */
            created_at: string;
        };
        /** DashboardNodeCard */
        DashboardNodeCard: {
            /** Node Id */
            node_id: string;
            /** Display Name */
            display_name: string;
            /** Node Type */
            node_type: string;
            /** Os Type */
            os_type: string | null;
            /** Hostname */
            hostname: string | null;
            /** Tags */
            tags: string[];
            /** Is Enabled */
            is_enabled: boolean;
            /** Heartbeat Interval Sec */
            heartbeat_interval_sec: number;
            /** First Seen At */
            first_seen_at: string | null;
            /** Last Seen At */
            last_seen_at: string | null;
            /**
             * Online Status
             * @enum {string}
             */
            online_status: "online" | "offline" | "never_seen" | "disabled";
            /**
             * Onboarding Status
             * @enum {string}
             */
            onboarding_status: "awaiting_first_heartbeat" | "connected" | "disabled";
            latest_status?: components["schemas"]["NodeStatusPreview"] | null;
            /** Active Task */
            active_task?: {
                [key: string]: unknown;
            } | null;
        };
        /** DashboardOverview */
        DashboardOverview: {
            /** Server Time */
            server_time: string;
            /** Node Counts */
            node_counts: {
                [key: string]: number;
            };
            /** Task Counts */
            task_counts: {
                [key: string]: number;
            };
            /** Nodes */
            nodes: components["schemas"]["DashboardNodeCard"][];
            /** Recent Tasks */
            recent_tasks: components["schemas"]["DashboardTaskSummary"][];
            /** Task Throughput 24H */
            task_throughput_24h?: number[];
        };
        /** DashboardTaskSummary */
        DashboardTaskSummary: {
            /** Task Id */
            task_id: string;
            /** Node Id */
            node_id: string;
            /** Type */
            type: string;
            /** Status */
            status: string;
            /** Created At */
            created_at: string;
            /** Claimed At */
            claimed_at?: string | null;
            /** Started At */
            started_at?: string | null;
            /** Finished At */
            finished_at?: string | null;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** HeartbeatCpu */
        HeartbeatCpu: {
            /**
             * Model
             * @description CPU model name reported by the node.
             */
            model?: string | null;
            /**
             * Logical Cores
             * @description Visible logical CPU core count.
             */
            logical_cores?: number | null;
            /**
             * Physical Cores
             * @description Physical CPU core count when detectable.
             */
            physical_cores?: number | null;
            /**
             * Usage Percent
             * @description Overall CPU utilization percentage.
             */
            usage_percent?: number | null;
            /**
             * Current Clock Mhz
             * @description Current effective CPU clock in MHz.
             */
            current_clock_mhz?: number | null;
            /**
             * Max Clock Mhz
             * @description Observed CPU max clock in MHz.
             */
            max_clock_mhz?: number | null;
            /**
             * Per Core Percent
             * @description Per-core utilization percentages.
             */
            per_core_percent?: number[];
        };
        /** HeartbeatDisk */
        HeartbeatDisk: {
            /**
             * Mount
             * @description Mount point or drive letter.
             */
            mount: string;
            /**
             * Total Bytes
             * @description Total disk capacity in bytes.
             */
            total_bytes?: number | null;
            /**
             * Free Bytes
             * @description Free disk space in bytes.
             */
            free_bytes?: number | null;
            /**
             * Usage Percent
             * @description Disk utilization percentage.
             */
            usage_percent?: number | null;
        };
        /** HeartbeatGpu */
        HeartbeatGpu: {
            /**
             * Index
             * @description Zero-based GPU index on the node.
             */
            index: number;
            /**
             * Model
             * @description GPU model name.
             */
            model?: string | null;
            /**
             * Total Vram Mb
             * @description Total VRAM in MiB.
             */
            total_vram_mb?: number | null;
            /**
             * Used Vram Mb
             * @description Used VRAM in MiB.
             */
            used_vram_mb?: number | null;
            /**
             * Utilization Percent
             * @description Core utilization percentage.
             */
            utilization_percent?: number | null;
            /**
             * Encoder Utilization Percent
             * @description NVENC utilization percentage.
             */
            encoder_utilization_percent?: number | null;
            /**
             * Decoder Utilization Percent
             * @description NVDEC utilization percentage.
             */
            decoder_utilization_percent?: number | null;
            /**
             * Temperature C
             * @description Current GPU temperature in Celsius.
             */
            temperature_c?: number | null;
            /**
             * Power Draw W
             * @description Current GPU power draw in watts.
             */
            power_draw_w?: number | null;
            /**
             * Power Limit W
             * @description Configured GPU power limit in watts.
             */
            power_limit_w?: number | null;
            /**
             * Clock Graphics Mhz
             * @description Current graphics clock in MHz.
             */
            clock_graphics_mhz?: number | null;
            /**
             * Clock Max Graphics Mhz
             * @description Maximum graphics clock in MHz.
             */
            clock_max_graphics_mhz?: number | null;
            /**
             * Clock Video Mhz
             * @description Current video clock in MHz.
             */
            clock_video_mhz?: number | null;
            /**
             * Fan Speed Percent
             * @description Fan speed percentage when available.
             */
            fan_speed_percent?: number | null;
            /**
             * Pcie Gen
             * @description Current PCIe generation.
             */
            pcie_gen?: number | null;
            /**
             * Pcie Width
             * @description Current PCIe lane width.
             */
            pcie_width?: number | null;
            /**
             * Encoder Sessions
             * @description Active encoder session count.
             */
            encoder_sessions?: number | null;
            /**
             * Decoder Sessions
             * @description Active decoder session count.
             */
            decoder_sessions?: number | null;
        };
        /** HeartbeatMemory */
        HeartbeatMemory: {
            /**
             * Total Bytes
             * @description Total system memory in bytes.
             */
            total_bytes?: number | null;
            /**
             * Used Bytes
             * @description Used system memory in bytes.
             */
            used_bytes?: number | null;
            /**
             * Usage Percent
             * @description Overall memory utilization percentage.
             */
            usage_percent?: number | null;
            /**
             * Available Bytes
             * @description Memory immediately available to new processes.
             */
            available_bytes?: number | null;
            /**
             * Cached Bytes
             * @description Cached memory in bytes when available.
             */
            cached_bytes?: number | null;
            /**
             * Commit Used Bytes
             * @description Committed memory currently in use.
             */
            commit_used_bytes?: number | null;
            /**
             * Commit Limit Bytes
             * @description Commit limit in bytes.
             */
            commit_limit_bytes?: number | null;
            /**
             * Paged Pool Bytes
             * @description Paged kernel pool bytes on Windows hosts.
             */
            paged_pool_bytes?: number | null;
            /**
             * Nonpaged Pool Bytes
             * @description Non-paged kernel pool bytes on Windows hosts.
             */
            nonpaged_pool_bytes?: number | null;
            /**
             * Speed Mtps
             * @description Memory speed in MT/s when detectable.
             */
            speed_mtps?: number | null;
            /**
             * Slots Used
             * @description Number of populated memory slots.
             */
            slots_used?: number | null;
            /**
             * Slots Total
             * @description Total motherboard memory slots.
             */
            slots_total?: number | null;
            /**
             * Form Factor
             * @description Memory module form factor.
             */
            form_factor?: string | null;
            /**
             * Memory Type
             * @description Memory technology such as DDR5.
             */
            memory_type?: string | null;
            /**
             * Installed Bytes
             * @description Installed physical memory in bytes.
             */
            installed_bytes?: number | null;
            /**
             * Hardware Reserved Bytes
             * @description Hardware-reserved memory in bytes.
             */
            hardware_reserved_bytes?: number | null;
        };
        /** HeartbeatNvidia */
        HeartbeatNvidia: {
            /**
             * Driver Version
             * @description Installed NVIDIA driver version.
             */
            driver_version?: string | null;
            /**
             * Cuda Version
             * @description CUDA runtime version.
             */
            cuda_version?: string | null;
            /**
             * Nvcc Version
             * @description nvcc compiler version when installed.
             */
            nvcc_version?: string | null;
            /**
             * Nvidia Smi Path
             * @description Resolved nvidia-smi executable path.
             */
            nvidia_smi_path?: string | null;
        };
        /** HeartbeatPythonEnv */
        HeartbeatPythonEnv: {
            /**
             * Python Executable
             * @description Resolved Python executable path.
             */
            python_executable?: string | null;
            /**
             * Venv Path
             * @description Virtual environment path if active.
             */
            venv_path?: string | null;
            /**
             * Pip Available
             * @default false
             */
            pip_available: boolean;
            /** Python Version */
            python_version?: string | null;
            /** Python Resolution Error */
            python_resolution_error?: string | null;
            /** Active Environment Kind */
            active_environment_kind?: string | null;
            /** Active Environment Name */
            active_environment_name?: string | null;
            /** Conda Prefix */
            conda_prefix?: string | null;
            /** Conda Default Env */
            conda_default_env?: string | null;
            /** Mamba Root Prefix */
            mamba_root_prefix?: string | null;
            /**
             * Uv Available
             * @default false
             */
            uv_available: boolean;
            /** Uv Executable */
            uv_executable?: string | null;
            /**
             * Conda Available
             * @default false
             */
            conda_available: boolean;
            /** Conda Executable */
            conda_executable?: string | null;
            /**
             * Micromamba Available
             * @default false
             */
            micromamba_available: boolean;
            /** Micromamba Executable */
            micromamba_executable?: string | null;
            /**
             * Supported Backends
             * @description Execution backends available on this node.
             */
            supported_backends?: string[];
        };
        /** HeartbeatResponse */
        HeartbeatResponse: {
            /** Server Time */
            server_time: string;
            /**
             * Accepted
             * @default true
             */
            accepted: boolean;
            /** Node Id */
            node_id: string;
            /** Tasks */
            tasks?: components["schemas"]["TaskEnvelope"][];
            /** Task Controls */
            task_controls?: components["schemas"]["TaskControlCommand"][];
            /**
             * Refresh Fingerprint
             * @description 若为 true, 节点收到后应异步重采完整指纹 (CPU 型号 / GPU 详情 / 虚拟化 / 网络 / Python 环境等), 下次心跳带新指纹.
             * @default false
             */
            refresh_fingerprint: boolean;
        };
        /** HeartbeatTaskRuntime */
        HeartbeatTaskRuntime: {
            /**
             * Active Task Id
             * @description Task id currently executing on the node.
             */
            active_task_id?: string | null;
            /**
             * Active Pid
             * @description Worker PID for the active task.
             */
            active_pid?: number | null;
            /**
             * Started At
             * @description UTC timestamp when the active task started.
             */
            started_at?: string | null;
        };
        /** LoginRequest */
        LoginRequest: {
            /** Username */
            username: string;
            /** Password */
            password: string;
        };
        /** NodeCreateRequest */
        NodeCreateRequest: {
            /** Node Id */
            node_id: string;
            /** Display Name */
            display_name: string;
            /**
             * Node Type
             * @default physical
             * @enum {string}
             */
            node_type: "physical" | "modal_runner" | "control_plane";
            /** Os Type */
            os_type?: ("windows" | "linux") | null;
            /** Hostname */
            hostname?: string | null;
            /**
             * Heartbeat Interval Sec
             * @default 5
             */
            heartbeat_interval_sec: number;
            /** Allowed Workdirs */
            allowed_workdirs?: string[];
            /** Tags */
            tags?: string[];
            /**
             * Allow Shell
             * @default false
             */
            allow_shell: boolean;
            /**
             * Allow Modal
             * @default false
             */
            allow_modal: boolean;
        };
        /** NodeCreateResponse */
        NodeCreateResponse: {
            /** Node Id */
            node_id: string;
            /** Display Name */
            display_name: string;
            /** Node Type */
            node_type: string;
            /** Os Type */
            os_type: string | null;
            /** Hostname */
            hostname: string | null;
            /** Heartbeat Interval Sec */
            heartbeat_interval_sec: number;
            /** Allowed Workdirs */
            allowed_workdirs: string[];
            /** Tags */
            tags: string[];
            /** Is Enabled */
            is_enabled: boolean;
            /** First Seen At */
            first_seen_at: string | null;
            /** Last Seen At */
            last_seen_at: string | null;
            /**
             * Connection Status
             * @enum {string}
             */
            connection_status: "online" | "offline" | "disabled" | "never_seen";
            /**
             * Onboarding Status
             * @enum {string}
             */
            onboarding_status: "awaiting_first_heartbeat" | "connected" | "disabled";
            /** Allow Shell */
            allow_shell: boolean;
            /** Allow Modal */
            allow_modal: boolean;
            /** Created At */
            created_at: string;
            /** Updated At */
            updated_at: string;
            /** Node Secret */
            node_secret: string;
            /**
             * Signing Hint
             * @default Agent should locally derive sha256(node_secret) and use it as the HMAC signing key; the server stores only an encrypted form.
             */
            signing_hint: string;
            onboarding: components["schemas"]["NodeOnboardingPackage"];
        };
        /** NodeOnboardingLifecycleResponse */
        NodeOnboardingLifecycleResponse: {
            /**
             * Token
             * @description Plain onboarding node secret while the node is still awaiting first heartbeat.
             */
            token?: string | null;
            /** Token Expires At */
            token_expires_at?: string | null;
            /**
             * Token Status
             * @enum {string}
             */
            token_status: "active" | "expired" | "consumed";
            /** Install Snippet */
            install_snippet: string;
            /** Env Template */
            env_template: string;
        };
        /** NodeOnboardingPackage */
        NodeOnboardingPackage: {
            /** Control Plane Url */
            control_plane_url: string;
            /** Env Template */
            env_template: string;
            /** Startup Command */
            startup_command: string;
            /** Onboarding Steps */
            onboarding_steps?: string[];
        };
        /** NodeResponse */
        NodeResponse: {
            /** Node Id */
            node_id: string;
            /** Display Name */
            display_name: string;
            /** Node Type */
            node_type: string;
            /** Os Type */
            os_type: string | null;
            /** Hostname */
            hostname: string | null;
            /** Heartbeat Interval Sec */
            heartbeat_interval_sec: number;
            /** Allowed Workdirs */
            allowed_workdirs: string[];
            /** Tags */
            tags: string[];
            /** Is Enabled */
            is_enabled: boolean;
            /** First Seen At */
            first_seen_at: string | null;
            /** Last Seen At */
            last_seen_at: string | null;
            /**
             * Connection Status
             * @enum {string}
             */
            connection_status: "online" | "offline" | "disabled" | "never_seen";
            /**
             * Onboarding Status
             * @enum {string}
             */
            onboarding_status: "awaiting_first_heartbeat" | "connected" | "disabled";
            /** Allow Shell */
            allow_shell: boolean;
            /** Allow Modal */
            allow_modal: boolean;
            /** Created At */
            created_at: string;
            /** Updated At */
            updated_at: string;
        };
        /** NodeStatusHistoryItem */
        NodeStatusHistoryItem: {
            /** Reported At */
            reported_at: string;
            /** Cpu Usage Percent */
            cpu_usage_percent?: number | null;
            /** Memory Usage Percent */
            memory_usage_percent?: number | null;
            /** Gpu Utilization Percent */
            gpu_utilization_percent?: number | null;
            /** Gpu Memory Percent */
            gpu_memory_percent?: number | null;
            /** Gpu Temperature C */
            gpu_temperature_c?: number | null;
            /** Gpu Power Draw W */
            gpu_power_draw_w?: number | null;
            /** Gpu Clock Graphics Mhz */
            gpu_clock_graphics_mhz?: number | null;
        };
        /** NodeStatusHistoryResponse */
        NodeStatusHistoryResponse: {
            /** Node Id */
            node_id: string;
            /** Items */
            items: components["schemas"]["NodeStatusHistoryItem"][];
        };
        /** NodeStatusPreview */
        NodeStatusPreview: {
            /**
             * Reported At
             * @description UTC timestamp when the status snapshot was reported.
             */
            reported_at: string;
            /** @description Structured CPU snapshot for the node. */
            cpu?: components["schemas"]["HeartbeatCpu"];
            /** @description Structured memory snapshot for the node. */
            memory?: components["schemas"]["HeartbeatMemory"];
            /**
             * Disks
             * @description Disk snapshots reported by the node.
             */
            disks?: components["schemas"]["HeartbeatDisk"][];
            /**
             * Gpus
             * @description GPU snapshots reported by the node.
             */
            gpus?: components["schemas"]["HeartbeatGpu"][];
            /** @description NVIDIA runtime metadata. */
            nvidia?: components["schemas"]["HeartbeatNvidia"];
            /** @description Python environment snapshot. */
            python_env?: components["schemas"]["HeartbeatPythonEnv"];
            /** @description Current active task runtime snapshot. */
            task_runtime?: components["schemas"]["HeartbeatTaskRuntime"];
            /**
             * Extra
             * @description Additional agent-provided status data.
             */
            extra?: {
                [key: string]: unknown;
            };
        };
        /** NodeUpdateRequest */
        NodeUpdateRequest: {
            /** Display Name */
            display_name?: string | null;
            /** Os Type */
            os_type?: ("windows" | "linux") | null;
            /** Hostname */
            hostname?: string | null;
            /** Heartbeat Interval Sec */
            heartbeat_interval_sec?: number | null;
            /** Allowed Workdirs */
            allowed_workdirs?: string[] | null;
            /** Tags */
            tags?: string[] | null;
            /** Is Enabled */
            is_enabled?: boolean | null;
            /** Allow Shell */
            allow_shell?: boolean | null;
            /** Allow Modal */
            allow_modal?: boolean | null;
        };
        /** RefreshRequest */
        RefreshRequest: {
            /** Refresh Token */
            refresh_token: string;
        };
        /** ReviewApproveRequest */
        ReviewApproveRequest: {
            /** Note */
            note?: string | null;
        };
        /** ReviewEscalateRequest */
        ReviewEscalateRequest: {
            /** Note */
            note?: string | null;
        };
        /** ReviewRejectRequest */
        ReviewRejectRequest: {
            /** Note */
            note?: string | null;
        };
        /** SecurityWarningPage */
        SecurityWarningPage: {
            /** Items */
            items: components["schemas"]["SecurityWarningView"][];
            /** Next Cursor */
            next_cursor?: string | null;
            /** Total Estimate */
            total_estimate?: number | null;
        };
        /** SecurityWarningView */
        SecurityWarningView: {
            /** Id */
            id: number;
            /** Source Type */
            source_type: string;
            /** Source Id */
            source_id: string | null;
            /** Warning Type */
            warning_type: string;
            /** Command Excerpt */
            command_excerpt: string | null;
            /** Detail */
            detail: {
                [key: string]: unknown;
            };
            /** Created At */
            created_at: string;
        };
        /** TaskControlCommand */
        TaskControlCommand: {
            /** Task Id */
            task_id: string;
            /**
             * Action
             * @constant
             */
            action: "cancel";
            /**
             * Kill Grace Sec
             * @default 15
             */
            kill_grace_sec: number;
        };
        /** TaskEnvelope */
        TaskEnvelope: {
            /** Task Id */
            task_id: string;
            /** Revision */
            revision: number;
            /** Idempotency Key */
            idempotency_key: string;
            /** Type */
            type: string;
            /** Payload */
            payload: {
                [key: string]: unknown;
            };
            /** Workdir */
            workdir?: string | null;
            /** Env */
            env?: {
                [key: string]: string;
            };
            /** Requested Gpu Ids */
            requested_gpu_ids?: number[];
            /**
             * Timeout Sec
             * @default 3600
             */
            timeout_sec: number;
            /**
             * Kill Grace Sec
             * @default 15
             */
            kill_grace_sec: number;
            /**
             * Danger Level
             * @default normal
             */
            danger_level: string;
        };
        /** TokenPair */
        TokenPair: {
            /** Access Token */
            access_token: string;
            /** Refresh Token */
            refresh_token: string;
            /**
             * Token Type
             * @default bearer
             * @constant
             */
            token_type: "bearer";
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    login_api_v1_admin_login_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenPair"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    refresh_api_v1_admin_refresh_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefreshRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenPair"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    logout_api_v1_admin_logout_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: boolean;
                    };
                };
            };
        };
    };
    me_api_v1_admin_me_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProfile"];
                };
            };
        };
    };
    get_overview_api_v1_admin_dashboard_overview_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DashboardOverview"];
                };
            };
        };
    };
    list_nodes_api_v1_admin_nodes_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NodeResponse"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_node_api_v1_admin_nodes_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NodeCreateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NodeCreateResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_node_api_v1_admin_nodes__node_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                node_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NodeResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_node_api_v1_admin_nodes__node_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                node_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_node_api_v1_admin_nodes__node_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                node_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NodeUpdateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NodeResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_node_onboarding_api_v1_admin_nodes__node_id__onboarding_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                node_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NodeOnboardingLifecycleResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    regenerate_node_onboarding_api_v1_admin_nodes__node_id__onboarding_regenerate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                node_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NodeOnboardingLifecycleResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    disable_node_api_v1_admin_nodes__node_id__disable_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                node_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NodeResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    enable_node_api_v1_admin_nodes__node_id__enable_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                node_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NodeResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reset_node_secret_api_v1_admin_nodes__node_id__reset_secret_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                node_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NodeCreateResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    refresh_fingerprint_api_v1_admin_nodes__node_id__refresh_fingerprint_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                node_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_latest_status_api_v1_admin_nodes__node_id__status_latest_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                node_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NodeStatusPreview"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_status_history_api_v1_admin_nodes__node_id__status_history_get: {
        parameters: {
            query?: {
                limit?: number;
                /** @description ISO8601: 取 reported_at >= since */
                since?: string | null;
                /** @description ISO8601: 取 reported_at <= until */
                until?: string | null;
            };
            header?: never;
            path: {
                node_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NodeStatusHistoryResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_audit_events_api_v1_admin_audit_events_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEventView"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_audits_page_api_v1_admin_audits_get: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string | null;
                actor_type?: string | null;
                action?: string | null;
                target_type?: string | null;
                since?: string | null;
                until?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEventPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_security_warnings_api_v1_admin_security_warnings_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SecurityWarningView"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_warnings_page_api_v1_admin_warnings_get: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string | null;
                warning_type?: string | null;
                source_type?: string | null;
                since?: string | null;
                until?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SecurityWarningPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_tasks_api_v1_admin_tasks_get: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string | null;
                node_id?: string | null;
                status?: string | null;
                type?: string | null;
                since?: string | null;
                until?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminTaskListPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_task_api_v1_admin_tasks_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminTaskCreateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminTaskDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_task_api_v1_admin_tasks__task_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminTaskDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cancel_task_api_v1_admin_tasks__task_id__cancel_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminTaskDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    escalate_review_api_v1_admin_tasks__task_id__review_escalate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewEscalateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminTaskDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    approve_review_api_v1_admin_tasks__task_id__review_approve_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewApproveRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminTaskDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reject_review_api_v1_admin_tasks__task_id__review_reject_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewRejectRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminTaskDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_task_logs_api_v1_admin_tasks__task_id__logs_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminTaskLogView"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_task_artifacts_api_v1_admin_tasks__task_id__artifacts_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminTaskArtifactView"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_alerts_api_v1_admin_alerts_get: {
        parameters: {
            query?: {
                status?: string | null;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlertMessageView"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    unread_count_api_v1_admin_alerts_unread_count_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: number;
                    };
                };
            };
        };
    };
    mark_read_api_v1_admin_alerts__alert_id__read_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                alert_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlertMessageView"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    heartbeat_api_v1_node_heartbeat_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HeartbeatResponse"];
                };
            };
        };
    };
    task_events_api_v1_node_task_events_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    task_log_chunk_api_v1_node_task_log_chunk_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    task_result_api_v1_node_task_result_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    artifact_upload_api_v1_node_artifact_upload_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    root__get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    healthz_healthz_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    readyz_readyz_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    console_index_console__path__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                path: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    console_index_console__get: {
        parameters: {
            query?: {
                path?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    console_index_console_get: {
        parameters: {
            query?: {
                path?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
