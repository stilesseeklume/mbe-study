import { KokoroTTS, TextSplitterStream, env } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
env.allowLocalModels=false;
const modelId="onnx-community/Kokoro-82M-v1.0-ONNX";let tts;
async function load(){try{self.postMessage({status:"loading",message:"正在下载 Kokoro 语音模型（首次约 86MB）",progress:5});tts=await KokoroTTS.from_pretrained(modelId,{dtype:"q8",device:"wasm",progress_callback:p=>{self.postMessage({status:"loading",message:p.file?`正在缓存 ${p.file}`:"正在准备语音模型",progress:p.progress||0})}});self.postMessage({status:"ready"})}catch(error){self.postMessage({status:"error",message:error?.message||String(error)})}}
load();
self.addEventListener("message",async event=>{if(!tts)return self.postMessage({status:"error",message:"语音模型尚未准备好"});try{const {text,voice="af_heart",speed=.92}=event.data,splitter=new TextSplitterStream();splitter.push(text);splitter.close();for await(const chunk of tts.stream(splitter,{voice,speed}))self.postMessage({status:"audio",blob:chunk.audio.toBlob(),text:chunk.text})}catch(error){self.postMessage({status:"error",message:error?.message||String(error)})}});
