// 大模型调用：Anthropic（Claude Opus 5，结构化输出）与 DeepSeek（JSON 模式）。都在浏览器直连，key 只存本机。
// 调用方只关心「给我一个过了 schema 的对象」，服务商差异、错误分类、花费估算都收在这里。
import { z } from 'zod'

export type Provider = 'anthropic' | 'deepseek'

export const MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-5',
  deepseek: 'deepseek-v4-flash',
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: 'Claude Opus 5',
  deepseek: 'DeepSeek V4 Flash',
}

// 每百万 token 价格（美元），面板上显示这次大概花了多少
const PRICE: Record<Provider, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  anthropic: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  deepseek: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0.44 },
}

export interface LlmConfig { provider: Provider; apiKey: string }

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; usd: number }

export type LlmErrorKind = 'auth' | 'rate' | 'network' | 'refusal' | 'bad_output' | 'other'

export class LlmError extends Error {
  constructor(message: string, public readonly kind: LlmErrorKind) { super(message) }
}

export interface StructuredCall<S extends z.ZodType> {
  system: string
  user: string
  /** 给 Claude 做结构化输出约束的 schema（只用结构化输出支持的写法：不要正则、长度范围） */
  schema: S
  /** 这次调用的思考深度；重排一天用 medium，兼顾质量和等待时间 */
  effort?: 'low' | 'medium' | 'high'
}

export interface StructuredResult<T> { data: T; usage: Usage; model: string }

const usd = (p: Provider, u: Omit<Usage, 'usd'>) => {
  const r = PRICE[p]
  return (u.input * r.input + u.output * r.output + u.cacheRead * r.cacheRead + u.cacheWrite * r.cacheWrite) / 1e6
}

/**
 * 去掉落单的代理项（半个 emoji）。按长度截断网上的攻略摘要时会把 emoji 从中间切开，
 * 浏览器照样发得出去，但 DeepSeek 解析请求会报 400「unexpected end of hex escape」（2026-09-29 手机上实际遇到）。
 */
export function cleanText(s: string): string {
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

/** 按字符（不按 UTF-16 单元）截断，emoji 不会被切开 */
export function cut(s: string, n: number): string {
  const chars = Array.from(s)
  return chars.length <= n ? s : chars.slice(0, n).join('')
}

export async function callStructured<S extends z.ZodType>(cfg: LlmConfig, req: StructuredCall<S>): Promise<StructuredResult<z.infer<S>>> {
  if (!cfg.apiKey) throw new LlmError(`还没有填 ${PROVIDER_LABEL[cfg.provider]} 的 API Key（在「同行」页右上角的设置里）`, 'auth')
  const clean = { ...req, system: cleanText(req.system), user: cleanText(req.user) }
  return cfg.provider === 'deepseek' ? viaDeepSeek(cfg.apiKey, clean) : viaAnthropic(cfg.apiKey, clean)
}

/**
 * Anthropic：浏览器直连（dangerouslyAllowBrowser），结构化输出按 schema 强约束。
 * 默认开启服务端 fallbacks：因安全策略拒答时由 Anthropic 改用推荐的备用模型完成同一请求。
 */
async function viaAnthropic<S extends z.ZodType>(apiKey: string, req: StructuredCall<S>): Promise<StructuredResult<z.infer<S>>> {
  // SDK 按需加载：不用 AI 的人不必下载它
  const [{ default: Anthropic }, { betaZodOutputFormat }] = await Promise.all([import('@anthropic-ai/sdk'), import('@anthropic-ai/sdk/helpers/beta/zod')])
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 })
  let response
  try {
    response = await client.beta.messages.parse({
      model: MODELS.anthropic,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }],
      output_config: { effort: req.effort ?? 'medium', format: betaZodOutputFormat(req.schema) },
    })
  } catch (e) {
    throw anthropicError(Anthropic, e)
  }
  if (response.stop_reason === 'refusal') {
    throw new LlmError('模型拒绝了这次请求' + (response.stop_details?.explanation ? `：${response.stop_details.explanation}` : ''), 'refusal')
  }
  if (response.stop_reason === 'max_tokens') throw new LlmError('模型的回答太长被截断了，少排几站再试', 'bad_output')
  const data = response.parsed_output
  if (data == null) throw new LlmError('模型返回的内容不符合格式，再试一次', 'bad_output')
  const u = response.usage
  const raw = { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 }
  return { data: data as z.infer<S>, usage: { ...raw, usd: usd('anthropic', raw) }, model: response.model }
}

function anthropicError(Anthropic: typeof import('@anthropic-ai/sdk').default, e: unknown): LlmError {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new LlmError('Claude API Key 无效或没有权限', 'auth')
  if (e instanceof Anthropic.RateLimitError) return new LlmError('Claude 限流了，等一会儿再试', 'rate')
  if (e instanceof Anthropic.APIConnectionError) return new LlmError('连不上 Claude 接口，检查一下网络', 'network')
  if (e instanceof Anthropic.APIError) return new LlmError(`Claude 返回错误（${e.status ?? '?'}）：${e.message}`, 'other')
  return new LlmError(e instanceof Error ? e.message : String(e), 'other')
}

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

/**
 * DeepSeek：OpenAI 兼容的 chat/completions，JSON 模式。它不认 schema，所以把 JSON 结构写进提示词，回来再过 zod。
 * 思考要关掉：开着时它先想上万字，把额度耗光、content 为空，还要等一两分钟（2026-09-28 真实联调）；
 * 关掉后两三秒返回，排得不对由外面的规则检查 + 修复循环兜底。万一仍被截断就加大额度重试一次。
 */
async function viaDeepSeek<S extends z.ZodType>(apiKey: string, req: StructuredCall<S>): Promise<StructuredResult<z.infer<S>>> {
  const call = async (maxTokens: number) => {
    let res: Response
    try {
      res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODELS.deepseek,
          thinking: { type: 'disabled' },
          messages: [{ role: 'system', content: req.system + '\n\n' + jsonShape(req.schema) }, { role: 'user', content: req.user }],
          response_format: { type: 'json_object' },
          max_tokens: maxTokens,
          stream: false,
        }),
      })
    } catch (e) {
      throw new LlmError('连不上 DeepSeek 接口（网络问题，或浏览器跨域被拦）：' + (e instanceof Error ? e.message : String(e)), 'network')
    }
    if (res.status === 401 || res.status === 403) throw new LlmError('DeepSeek API Key 无效', 'auth')
    if (res.status === 429) throw new LlmError('DeepSeek 限流了，等一会儿再试', 'rate')
    if (res.status === 402) throw new LlmError('DeepSeek 账户余额不足，去 platform.deepseek.com 充值', 'auth')
    // 带上接口给的原因，只报状态码没法查
    if (!res.ok) {
      // 原因可能是 JSON（{error:{message}}），也可能是纯文本
      const raw = await res.text().catch(() => '')
      let why = raw
      try { why = (JSON.parse(raw) as { error?: { message?: string } })?.error?.message ?? raw } catch { /* 纯文本就用原文 */ }
      why = why.trim().slice(0, 200)
      throw new LlmError(`DeepSeek 返回错误（${res.status}）${why ? '：' + why : ''}`, 'other')
    }
    return res.json()
  }
  let j = await call(8000)
  if (!j.choices?.[0]?.message?.content && j.choices?.[0]?.finish_reason === 'length') j = await call(16000)
  const text: string = j.choices?.[0]?.message?.content ?? ''
  const data = parseLooseJson(text, req.schema)
  const u = j.usage ?? {}
  const raw = { input: (u.prompt_tokens ?? 0) - (u.prompt_cache_hit_tokens ?? 0), output: u.completion_tokens ?? 0, cacheRead: u.prompt_cache_hit_tokens ?? 0, cacheWrite: 0 }
  return { data, usage: { ...raw, usd: usd('deepseek', raw) }, model: j.model ?? MODELS.deepseek }
}

/** 把 schema 写成提示词：DeepSeek 不认 schema，不写明它会自己起字段名 */
export function jsonShape(schema: z.ZodType): string {
  const js = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>
  delete js.$schema
  return '只输出一个 JSON 对象（json），不要任何解释。字段名、枚举值必须严格照下面的 JSON Schema，不要增减字段：\n' + JSON.stringify(js)
}

/** 宽松解析：去掉代码围栏、截出最外层的 {…}，再过 schema */
export function parseLooseJson<S extends z.ZodType>(text: string, schema: S): z.infer<S> {
  let t = text.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)
  if (fence) t = fence[1].trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b < 0) throw new LlmError('模型没有返回 JSON', 'bad_output')
  let raw: unknown
  try { raw = JSON.parse(t.slice(a, b + 1)) } catch { throw new LlmError('模型返回的 JSON 解析不了', 'bad_output') }
  const r = schema.safeParse(raw)
  if (!r.success) throw new LlmError('模型返回的结构不对：' + r.error.issues.slice(0, 2).map(i => `${i.path.join('.')} ${i.message}`).join('；'), 'bad_output')
  return r.data
}
