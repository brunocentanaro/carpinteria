from __future__ import annotations


QUOTA_MESSAGE = (
    "La API key de OpenAI se quedo sin cuota o billing disponible. "
    "Revisa el plan/billing de OpenAI o cambia OPENAI_API_KEY por una key con credito. "
    "Mientras tanto, las funciones que dependen del modelo no van a poder responder."
)


def is_quota_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return (
        "exceeded your current quota" in text
        or "insufficient_quota" in text
        or "check your plan and billing" in text
    )


def friendly_openai_error(exc: BaseException) -> str:
    if is_quota_error(exc):
        return QUOTA_MESSAGE
    return str(exc)
