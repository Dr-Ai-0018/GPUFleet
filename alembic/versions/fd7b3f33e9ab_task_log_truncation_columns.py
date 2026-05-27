"""Add task log truncation metadata columns.

Revision ID: fd7b3f33e9ab
Revises: 51e0a296f5bf
Create Date: 2026-05-26 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "fd7b3f33e9ab"
down_revision = "51e0a296f5bf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("task_logs") as batch_op:
        batch_op.add_column(sa.Column("is_truncated", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("truncated_notice", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("task_logs") as batch_op:
        batch_op.drop_column("truncated_notice")
        batch_op.drop_column("is_truncated")
