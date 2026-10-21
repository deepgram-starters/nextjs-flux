"use client";
import { useRef, useState } from "react";

function pcm16(samples) {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) output[index] = Math.max(-1, Math.min(1, samples[index])) * 0x7fff;
  return output.buffer;
}

export default function Page() {
  const [events, setEvents] = useState([]);
  const stopRef = useRef(null);
  const add = (event) => setEvents((current) => [event, ...current].slice(0, 20));

  async function start() {
    const { token } = await fetch("/api/session").then((response) => response.json());
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}/api/flux?encoding=linear16&sample_rate=16000`, [`access_token.${token}`]);
    socket.onmessage = (event) => add(event.data);
    socket.onerror = () => add("WebSocket error");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new AudioContext({ sampleRate: 16000 });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => { if (socket.readyState === WebSocket.OPEN) socket.send(pcm16(event.inputBuffer.getChannelData(0))); };
    source.connect(processor); processor.connect(context.destination);
    stopRef.current = () => { socket.send(JSON.stringify({ type: "CloseStream" })); socket.close(); processor.disconnect(); source.disconnect(); context.close(); stream.getTracks().forEach((track) => track.stop()); };
    add("Listening for speech...");
  }

  return <main><p>Deepgram starter</p><h1>Detect the end of a turn.</h1><p>Flux streams microphone audio and returns real-time turn events.</p><button onClick={() => stopRef.current ? stopRef.current() : start()}>{stopRef.current ? "Stop" : "Start microphone"}</button><pre>{events.join("\n\n") || "Events will appear here."}</pre></main>;
}
