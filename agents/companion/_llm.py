# LLM 工厂：健康档案和用药整理使用 MiMo OpenAI 兼容接口
from langchain_openai import ChatOpenAI

DEFAULT_MODEL = "mimo-v2.6-flash"
_model_cache: dict = {}


def get_model(env: dict, temperature: float = 0.3) -> ChatOpenAI:
    api_key = env.get("MIMO_API_KEY")
    base_url = (env.get("MIMO_BASE_URL") or "https://api.xiaomimimo.com/v1").rstrip("/")
    if not api_key or not base_url:
        raise RuntimeError("缺少 MIMO_API_KEY 环境变量")
    model_name = env.get("MIMO_LLM_MODEL") or DEFAULT_MODEL
    key = (base_url, model_name, temperature)
    if key not in _model_cache:
        common = dict(
            model=model_name,
            api_key=api_key,
            base_url=base_url,
            temperature=temperature,
            timeout=45,
            streaming=True,
        )
        try:
            # 关闭长思考，保持对话和结构化提取响应速度。
            _model_cache[key] = ChatOpenAI(**common, model_kwargs={"thinking": {"type": "disabled"}})
        except Exception:
            _model_cache[key] = ChatOpenAI(**common)
    return _model_cache[key]
