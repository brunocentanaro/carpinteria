from __future__ import annotations

from abc import ABC, abstractmethod

from carpinteria.schemas import ShippingQuote


class ShippingProvider(ABC):
    @abstractmethod
    def get_quote(self, destination: str, volume_description: str = "") -> ShippingQuote | None: ...


class NullShippingProvider(ShippingProvider):
    def get_quote(self, destination: str, volume_description: str = "") -> ShippingQuote | None:
        return None


class FixedShippingProvider(ShippingProvider):
    def __init__(self, rates: dict[str, float]):
        self._rates = {k.lower(): v for k, v in rates.items()}

    def get_quote(self, destination: str, volume_description: str = "") -> ShippingQuote | None:
        dest_l = destination.lower()
        for key, price in self._rates.items():
            if key in dest_l or dest_l in key:
                return ShippingQuote(description=f"Flete a {destination}", price=price)
        return None
