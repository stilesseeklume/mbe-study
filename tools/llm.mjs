const BASE='https://api.minimaxi.com/v1/text/chatcompletion_v2';
export async function chat(messages,{model=process.env.GRADING_MODEL||'MiniMax-Text-01',temperature=0.2,max_tokens=2000}={}){
  const key=process.env.MINIMAX_API_KEY;if(!key)throw Error('需要 MINIMAX_API_KEY 环境变量');
  const res=await fetch(BASE,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages,temperature,max_tokens})});
  const data=await res.json();
  if(!res.ok||data.base_resp?.status_code)throw Error(data.base_resp?.status_msg||`MiniMax ${res.status}`);
  return data.choices[0].message.content;
}
export async function chatJSON(messages,opts){const raw=await chat(messages,opts);const m=raw.match(/\{[\s\S]*\}/);if(!m)throw Error('LLM 未返回 JSON');return JSON.parse(m[0])}
