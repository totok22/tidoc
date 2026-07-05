"""组件的输入数据结构。核心把条目查好后转成这些轻量 dict 传入，
组件不直接依赖核心的 db 层，耦合最小。"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal


@dataclass
class PrintItem:
    """打印用的一条物品明细。"""
    actual_name: str = ""
    product_name: str = ""     # 验收单用；默认同 actual_name
    unit: str = ""
    quantity: Decimal | None = None
    total: Decimal = Decimal("0")
    seller: str = ""
    invoice_no: str = ""
    storage_location: str = ""

    @property
    def unit_price(self) -> Decimal:
        if self.quantity and self.quantity != 0:
            return self.total / self.quantity
        return self.total


@dataclass
class PrintEntry:
    """打印用的一个报账条目（对应一张发票）。"""
    entry_id: str = ""
    title: str = ""            # 抬头，强隔离关键字段
    invoice_no: str = ""
    invoice_date: str = ""
    seller: str = ""
    total: Decimal = Decimal("0")
    paid_amount: str = ""      # 实付金额（可改字段）
    profile_name: str = ""     # 报账人姓名
    reviewer: str = ""
    items: list[PrintItem] = field(default_factory=list)
    # 附件的绝对路径，按类型分组
    invoice_pdfs: list[str] = field(default_factory=list)
    payment_images: list[str] = field(default_factory=list)
    inspection_pdfs: list[str] = field(default_factory=list)


@dataclass
class PersonProfile:
    """报账说明抬头段用的个人信息。"""
    person_name: str = ""
    student_id: str = ""
    contact: str = ""
    bank_name: str = ""
    bank_card: str = ""
