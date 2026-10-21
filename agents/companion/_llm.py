# LLM 工厂：按 (base_url, temperature) 缓存 ChatOpenAI 实例
from langchain_openai import ChatOpenAI

DEFAULT_MODEL = "@makers/deepseek-v4-flash"
_model_cache: dict = {}


def get_model(env: dict, temperature: float = 0.3) -> ChatOpenAI:
    api_key = env.get("AI_GATEWAY_API_KEY")
    base_url = env.get("AI_GATEWAY_BASE_URL")
    if not api_key or not base_url:
        raise RuntimeError("缺少 AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL 环境变量")
    key = (base_url, temperature)
    if key not in _model_cache:
        common = dict(
            model=env.get("AI_GATEWAY_MODEL") or DEFAULT_MODEL,
            api_key=api_key,
            base_url=base_url,
            temperature=temperature,
            timeout=120,
            streaming=False,
        )
        try:
            # 关闭推理思考：首字延迟约减半（语音对话等不起）；老版本不支持该字段时退回默认
            _model_cache[key] = ChatOpenAI(**common, model_kwargs={"reasoning_effort": "none"})
        except Exception:
            _model_cache[key] = ChatOpenAI(**common)
    return _model_cache[key]
