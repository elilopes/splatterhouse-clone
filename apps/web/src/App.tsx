import { useEffect, useState } from "react";
import GameView, { type GraphicsQuality } from "./game/GameView";
import { loadLocalProgress, saveLocalProgress } from "./game/save";
import type { GameProgress } from "./game/types";
import { auth, cloudSave, firebaseReady, signInGoogle, signInGuest } from "./firebase/client";

type Screen = "title" | "playing";

export default function App() {
  const [progress, setProgress] = useState<GameProgress>(() => loadLocalProgress());
  const [paused, setPaused] = useState(false);
  const [screen, setScreen] = useState<Screen>("title");
  const [selectedStartStage, setSelectedStartStage] = useState<1 | 2 | 3>(1);
  const [currentPhase, setCurrentPhase] = useState<1 | 2 | 3>(1);
  const [phase3Cleared, setPhase3Cleared] = useState(false);
  const [gameRunId, setGameRunId] = useState(0);
  const [message, setMessage] = useState("Modo visitante — progresso salvo neste dispositivo");
  const [graphicsQuality,setGraphicsQuality] = useState<GraphicsQuality>(() => {
    try {
      const saved=localStorage.getItem("splatterhouse-graphics-quality");
      return saved==="standard"||saved==="high"||saved==="auto"?saved:"auto";
    } catch { return "auto"; }
  });

  useEffect(()=>{
    try { localStorage.setItem("splatterhouse-graphics-quality",graphicsQuality); } catch { /* armazenamento opcional */ }
  },[graphicsQuality]);

  useEffect(() => saveLocalProgress(progress), [progress]);

  async function connectGoogle() {
    try { const result=await signInGoogle(); await cloudSave(result.user.uid,progress); setMessage(`Conta Google conectada: ${result.user.displayName??result.user.email}`); }
    catch(error){setMessage(error instanceof Error?error.message:"Falha ao conectar.");}
  }
  async function continueAsGuest() {
    try { const result=await signInGuest(); await cloudSave(result.user.uid,progress); setMessage("Visitante autenticado e progresso sincronizado."); }
    catch(error){setMessage(error instanceof Error?error.message:"Falha na autenticação visitante.");}
  }
  function startGame(){
    setCurrentPhase(selectedStartStage);
    setPaused(false);
    setPhase3Cleared(false);
    setGameRunId(id=>id+1);
    setScreen("playing");
  }

  return (
    <main className={`app-shell ${screen === "title" ? "title-screen" : "playing-screen"}`}>
      {screen === "title" ? (
        <section className="title-menu">
          <div className="title-atmosphere" aria-hidden="true" />
          <div className="title-content">
            <span className="eyebrow">UM PESADELO ESTÁ APENAS COMEÇANDO</span>
            <h1>SPLATTERHOUSE</h1>
            <p className="title-subtitle">A MANSÃO NÃO DEIXARÁ VOCÊ SAIR.</p>
            <div className="graphics-settings">
              <label htmlFor="graphics-quality">Qualidade gráfica</label>
              <select id="graphics-quality" value={graphicsQuality} onChange={event=>setGraphicsQuality(event.target.value as GraphicsQuality)}>
                <option value="auto">Automática — melhor compatível</option>
                <option value="standard">Padrão — Rick convencional / WebGL</option>
                <option value="high">Alta — Rick HD / WebGPU</option>
              </select>
              <small>Alta usa o modo padrão automaticamente se WebGPU não estiver disponível.</small>
              <label htmlFor="start-stage" style={{marginTop:"8px"}}>Fase inicial</label>
              <select id="start-stage" value={selectedStartStage} onChange={event=>setSelectedStartStage(Number(event.target.value) as 1|2|3)}>
                <option value={1}>Fase 01 — Exterior (Rolagem 2,5D)</option>
                <option value={2}>Fase 02 — Salão da Mansão (2,5D)</option>
                <option value={3}>Fase 03 — Corredor dos Quartos (TPS)</option>
              </select>
            </div>
            <button className="start-button" onClick={startGame}>INICIAR JOGO</button>
            <div className="title-account">
              <span>{message}</span>
              <div className="account-actions">
                <button disabled={!firebaseReady} onClick={connectGoogle}>Entrar com Google</button>
                <button className="secondary" disabled={!firebaseReady} onClick={continueAsGuest}>Salvar como visitante</button>
              </div>
            </div>
            <span className="title-footer">PROTÓTIPO · BUILD 0.2.0</span>
          </div>
        </section>
      ) : (
        <>
          <header className="topbar">
            <div><span className="eyebrow">CAMPANHA • O DESPERTAR</span><h1>SPLATTERHOUSE</h1></div>
            <div className="account-actions"><span className="save-status">{auth?.currentUser?"Conta conectada":message}</span><button className="secondary" onClick={()=>setPaused(v=>!v)} disabled={phase3Cleared}>{paused?"Continuar":"Pausar"}</button><button className="secondary" onClick={()=>setScreen("title")}>Menu inicial</button></div>
          </header>
          <section className="game-layout">
            <div className="game-frame">
              <GameView
                key={`run-${gameRunId}-${selectedStartStage}`}
                graphicsQuality={graphicsQuality}
                paused={paused||phase3Cleared}
                initialStage={selectedStartStage}
                onScore={points=>setProgress(p=>({...p,totalScore:p.totalScore+points}))}
                onKill={()=>setProgress(p=>({...p,totalKills:p.totalKills+1}))}
                onPhase3Clear={()=>setPhase3Cleared(true)}
                onStageChange={stage=>{
                  setCurrentPhase(stage);
                  const checkpoint=stage===1?"mansao-exterior-start":stage===2?"mansao-interior-entry":"mansao-corredor-quartos";
                  setProgress(p=>({...p,currentStage:stage,unlockedStages:[...new Set([...p.unlockedStages,stage])],checkpoint}));
                }}
              />
              <div className="hud">
                <div><small>FASE</small><strong>0{currentPhase}/03</strong></div>
                <div><small>LOCAL</small><strong>{currentPhase===1?"TERRENO":currentPhase===2?"MANSÃO":"CORREDOR"}</strong></div>
                <div><small>PONTUAÇÃO</small><strong>{progress.totalScore.toLocaleString("pt-BR")}</strong></div>
              </div>
              {paused&&!phase3Cleared&&<div className="pause-overlay"><h2>JOGO PAUSADO</h2><button onClick={()=>setPaused(false)}>CONTINUAR</button><button className="secondary" onClick={()=>setScreen("title")}>MENU INICIAL</button></div>}
              {phase3Cleared&&<div className="pause-overlay victory-overlay">
                <span className="eyebrow">FASE 03 CONCLUÍDA</span>
                <h2>CORREDOR CONCLUÍDO</h2>
                <p className="victory-stats">Pontuação: {progress.totalScore.toLocaleString("pt-BR")} · Eliminações: {progress.totalKills}</p>
                <div className="victory-actions">
                  <button onClick={startGame}>JOGAR NOVAMENTE</button>
                  <button className="secondary" onClick={()=>setScreen("title")}>MENU INICIAL</button>
                </div>
              </div>}
            </div>
            <aside className="side-panel">
              <span className="eyebrow">{currentPhase===1?"FASE 01 · EXTERIOR":currentPhase===2?"FASE 02 · INTERIOR":"FASE 03 · CORREDOR TPS"}</span>
              <h2>{currentPhase===1?"O terreno da mansão":currentPhase===2?"Dentro da mansão":"Corredor dos quartos"}</h2>
              {currentPhase===2 && <p>Explore o salão da mansão em perspectiva 2,5D e suba a escadaria até a porta superior para entrar no corredor dos quartos.</p>}
              {currentPhase===3 && <p>Avance em terceira pessoa sobre o ombro pelos quartos assombrados da mansão, usando mesas e baús como cobertura contra as emboscadas das portas.</p>}
              {currentPhase===1 ? (
                <div className="stage-list"><span className="active">01 · Muro gosmento</span><span>02 · Bosque de árvores</span><span>03 · Frente da mansão</span></div>
              ) : currentPhase===2 ? (
                <div className="stage-list"><span className="active">01 · Salão principal</span><span>02 · Escadaria superior</span><span>03 · Porta do corredor</span></div>
              ) : (
                <div className="stage-list"><span className="active">01 · Quartos 01–04</span><span>02 · Quartos 05–08</span><span>03 · Suíte Principal</span></div>
              )}
              <div className="stat"><span>Checkpoint</span><b>{progress.checkpoint}</b></div>
              <div className="stat"><span>Eliminações</span><b>{progress.totalKills}</b></div>
              {currentPhase===3 ? (
                <p className="hint">Mover: WASD/setas · Mirar: mouse/setas ou arraste na tela · Atirar: clique esquerdo / J · Zoom sobre o ombro: botão direito / Shift · Recarregar: R · Pulo: Espaço.</p>
              ) : (
                <>
                  <p className="hint">Mover: WASD/setas ou joystick virtual · Soco/ataque: J · Agarrão: K · Pulo: Espaço · Recolher arma: aproxime-se (coleta automática no mobile) ou pressione E no teclado. Use os botões na tela com mouse ou toque.</p>
                  <p className="hint">Sequência de armas: mãos → cano → facão → escopeta. A entrada da mansão leva à Fase 02 e a porta do topo da escada leva à Fase 03.</p>
                </>
              )}
            </aside>
          </section>
        </>
      )}
      {screen==="playing"&&<footer>BUILD 0.2.0 · FASE 01: ROLAGEM HORIZONTAL · FASE 02: AMBIENTE 2,5D · FASE 03: TIRO EM 3ª PESSOA</footer>}
    </main>
  );
}
