"""snapshot hot metric columns

Revision ID: 51e0a296f5bf
Revises: 4c941b389965
Create Date: 2026-05-26 14:22:07.157119
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "51e0a296f5bf"
down_revision: Union[str, Sequence[str], None] = "4c941b389965"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("node_status_snapshots") as batch_op:
        batch_op.add_column(sa.Column("cpu_usage_percent", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("memory_usage_percent", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("gpu_utilization_percent", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("gpu_memory_percent", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("gpu_temperature_c", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("gpu_power_draw_w", sa.Float(), nullable=True))

    op.execute(
        """
        UPDATE node_status_snapshots
        SET cpu_usage_percent = CAST(json_extract(cpu_json, '$.usage_percent') AS REAL),
            memory_usage_percent = CAST(json_extract(memory_json, '$.usage_percent') AS REAL),
            gpu_utilization_percent = CAST(json_extract(gpu_json, '$.gpus[0].utilization_percent') AS REAL),
            gpu_memory_percent = CASE
                WHEN CAST(json_extract(gpu_json, '$.gpus[0].total_vram_mb') AS REAL) > 0
                THEN CAST(json_extract(gpu_json, '$.gpus[0].used_vram_mb') AS REAL) * 100.0
                     / CAST(json_extract(gpu_json, '$.gpus[0].total_vram_mb') AS REAL)
                ELSE NULL
            END,
            gpu_temperature_c = CAST(json_extract(gpu_json, '$.gpus[0].temperature_c') AS REAL),
            gpu_power_draw_w = CAST(json_extract(gpu_json, '$.gpus[0].power_draw_w') AS REAL)
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("node_status_snapshots") as batch_op:
        batch_op.drop_column("gpu_power_draw_w")
        batch_op.drop_column("gpu_temperature_c")
        batch_op.drop_column("gpu_memory_percent")
        batch_op.drop_column("gpu_utilization_percent")
        batch_op.drop_column("memory_usage_percent")
        batch_op.drop_column("cpu_usage_percent")
