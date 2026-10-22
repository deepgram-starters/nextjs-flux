"use client";

import { useEffect, useRef, useState } from "react";

function pcm16(samples) {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

function EventBadge({ event }) {
  const labels = { StartOfTurn: "Start", Update: "Update", EagerEndOfTurn: "Eager EOT", TurnResumed: "Resumed", EndOfTurn: "Final" };
  if (!event) return <span className="turn-event-badge invisible">-</span>;
  return <span className={`turn-event-badge turn-event-badge--${event}`}>{labels[event] || event}</span>;
}

export default function Page() {
  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const streamRef = useRef(null);
  const completedTurnsRef = useRef(new Set());
  const [title, setTitle] = useState("Flux Transcription");
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [messageCount, setMessageCount] = useState(0);
  const [turnCount, setTurnCount] = useState(0);
  const [requestId, setRequestId] = useState("-");
  const [micStatus, setMicStatus] = useState("Inactive");
  const [currentEvent, setCurrentEvent] = useState(null);
  const [turns, setTurns] = useState([]);
  const [config, setConfig] = useState({ threshold: "0.70", eagerEnabled: false, eagerThreshold: "0.60", timeout: "5000", keyterms: "" });

  useEffect(() => {
    fetch("/api/metadata").then((response) => response.ok ? response.json() : null).then((data) => {
      if (data?.title) { setTitle(data.title); document.title = data.title; }
    }).catch(() => {});
    return () => disconnect();
  }, []);

  function updateConfig(name, value) { setConfig((current) => ({ ...current, [name]: value })); }

  function closeAudio() {
    processorRef.current?.disconnect(); sourceRef.current?.disconnect();
    processorRef.current = null; sourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    audioRef.current?.close(); audioRef.current = null;
    setMicStatus("Inactive");
  }

  function disconnect() {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "CloseStream" }));
    socket?.close(); closeAudio(); setConnected(false); setConnecting(false); setCurrentEvent(null);
  }

  function applyTurn(data) {
    const event = data.event || "Update";
    const index = data.turn_index ?? 0;
    setCurrentEvent(event);
    setTurns((current) => {
      const found = current.findIndex((turn) => turn.index === index);
      const next = { index, event, transcript: data.transcript || current[found]?.transcript || "" };
      if (found === -1) return [...current, next];
      return current.map((turn, turnIndex) => turnIndex === found ? next : turn);
    });
    if (event === "EndOfTurn" && !completedTurnsRef.current.has(index)) {
      completedTurnsRef.current.add(index); setTurnCount((count) => count + 1);
    }
  }

  async function start() {
    if (connecting || connected) return;
    setError(""); setConnecting(true); setMicStatus("Requesting microphone...");
    try {
      const sessionResponse = await fetch("/api/session");
      if (!sessionResponse.ok) throw new Error("Unable to start a session.");
      const { token } = await sessionResponse.json();
      const params = new URLSearchParams({ encoding: "linear16", sample_rate: "16000", eot_threshold: config.threshold, eot_timeout_ms: config.timeout });
      if (config.eagerEnabled) params.set("eager_eot_threshold", config.eagerThreshold);
      config.keyterms.split(",").map((term) => term.trim()).filter(Boolean).forEach((term) => params.append("keyterm", term));
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${scheme}://${location.host}/api/flux?${params}`, [`access_token.${token}`]);
      socketRef.current = socket;
      socket.onmessage = (event) => {
        setMessageCount((count) => count + 1);
        try {
          const data = JSON.parse(event.data);
          if (data.type === "Connected" && data.request_id) setRequestId(data.request_id);
          if (data.type === "TurnInfo") applyTurn(data);
          if (data.type === "Error") setError(data.message || "Deepgram returned an error.");
        } catch { setError("Received an unreadable server message."); }
      };
      socket.onerror = () => setError("WebSocket connection failed.");
      socket.onclose = () => { if (socketRef.current === socket) { socketRef.current = null; closeAudio(); setConnected(false); setConnecting(false); setCurrentEvent(null); } };
      socket.onopen = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true } });
          if (socketRef.current !== socket) { stream.getTracks().forEach((track) => track.stop()); return; }
          const context = new AudioContext({ sampleRate: 16000 });
          const source = context.createMediaStreamSource(stream);
          const processor = context.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (audioEvent) => { if (socket.readyState === WebSocket.OPEN) socket.send(pcm16(audioEvent.inputBuffer.getChannelData(0))); };
          source.connect(processor); processor.connect(context.destination);
          streamRef.current = stream; audioRef.current = context; sourceRef.current = source; processorRef.current = processor;
          setConnected(true); setConnecting(false); setMicStatus("Active");
        } catch {
          setError("Microphone access was not granted."); disconnect();
        }
      };
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Unable to connect."); setConnecting(false); setMicStatus("Inactive");
    }
  }

  const disabled = connected || connecting;
  return <div className="flux-app">
    <header className="flux-header"><strong>DEEPGRAM <span>{title}</span></strong><nav><a href="https://github.com/deepgram-starters" target="_blank" rel="noreferrer">GitHub</a><a className="outlined-link" href="https://console.deepgram.com" target="_blank" rel="noreferrer">Free API Key</a></nav></header>
    <div className="flux-columns">
      <aside className="flux-sidebar config-sidebar"><h1>Configuration</h1><label>EOT Threshold <div className="range-line"><input type="range" min="0.5" max="0.9" step="0.05" value={config.threshold} disabled={disabled} onChange={(event) => updateConfig("threshold", event.target.value)} /><output>{Number(config.threshold).toFixed(2)}</output></div></label><label className="toggle"><input type="checkbox" checked={config.eagerEnabled} disabled={disabled} onChange={(event) => updateConfig("eagerEnabled", event.target.checked)} /> Enable Eager EOT</label><label className={config.eagerEnabled ? "" : "dimmed"}>Eager EOT Threshold <div className="range-line"><input type="range" min="0.3" max="0.9" step="0.05" value={config.eagerThreshold} disabled={disabled || !config.eagerEnabled} onChange={(event) => updateConfig("eagerThreshold", event.target.value)} /><output>{Number(config.eagerThreshold).toFixed(2)}</output></div></label><label>EOT Timeout (ms)<input type="number" min="1000" max="30000" step="500" value={config.timeout} disabled={disabled} onChange={(event) => updateConfig("timeout", event.target.value)} /></label><label>Key Terms<input value={config.keyterms} disabled={disabled} onChange={(event) => updateConfig("keyterms", event.target.value)} placeholder="term1, term2, term3" /></label></aside>
      <main className="transcript-panel">
        {error && <div className="error-alert"><strong>Error</strong><span>{error}</span></div>}
        {!connected && <div className="connect-overlay"><div className="connect-prompt"><div className="mic-mark">MIC</div><h2>Flux Transcription Ready</h2><p>Configure settings and connect to begin turn-based transcription.</p><button className="connect-button" disabled={connecting} onClick={start}>{connecting ? "Connecting..." : "Connect"}</button></div></div>}
        {connected && <button className="disconnect-button" onClick={disconnect}>Disconnect</button>}
        <div className="transcript-container">{turns.length === 0 ? <div className="waiting"><div>MIC</div><p>Waiting for audio...</p></div> : turns.map((turn) => <div className="turn-block" key={turn.index}><article className={`transcript-item transcript-item--${turn.event}`}><header><EventBadge event={turn.event} /><span>Turn {turn.index + 1}</span></header><p>{turn.transcript || "Listening..."}</p></article>{turn.event === "EndOfTurn" && <div className="turn-marker">Turn {turn.index + 1} complete</div>}</div>)}</div>
      </main>
      <aside className="flux-sidebar status-sidebar"><h1>Status</h1><dl><div><dt>Connection</dt><dd className={connected ? "connected" : ""}><i />{connecting ? "Connecting" : connected ? "Connected" : "Disconnected"}</dd></div><div><dt>Microphone</dt><dd className={micStatus === "Active" ? "connected" : ""}>{micStatus}</dd></div><div><dt>Request ID</dt><dd className="mono">{requestId}</dd></div><div><dt>Messages Received</dt><dd>{messageCount}</dd></div><div><dt>Completed Turns</dt><dd>{turnCount}</dd></div><div><dt>Current Turn</dt><dd><EventBadge event={currentEvent} /></dd></div></dl></aside>
    </div>
  </div>;
}
