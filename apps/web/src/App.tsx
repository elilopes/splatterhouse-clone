import { useEffect, useState } from "react";
import GameView from "./game/GameView";
import { loadLocalProgress, saveLocalProgress } from "./game/save";
import type { GameProgress } from "./game/types";
import { auth, cloudSave, firebaseReady, signInGoogle, signInGuest } from "./firebase/client";

type Screen = "title" | "playing";

export default function App() {
  const [progress, setProgress] = useState<GameProgress>(() => loadLocalProgress());
  const [paused, setPaused] = useState(false);
  const [screen, setScreen] = useState<Screen>("title");
  const [currentPhase, setCurrentPhase] = useState<1 | 2>(1);
  const [message, setMessage] = useState("Modo visitante — progresso salvo neste dispositivo");

  useEffect(() => saveLocalProgress(progress), [progress]);

  async function connectGoogle() {
    try { const result=await signInGoogle(); await cloudSave(result.user.uid,progress); setMessage(`Conta Google conectada: ${result.user.displayName??result.user.email}`); }
    catch(error){setMessage(error instanceof Error?error.message:"Falha ao conectar.");}
  }
  async function continueAsGuest() {
    try { const result=await signInGuest(); await cloudSave(result.user.uid,progress); setMessage("Visitante autenticado e progresso sincronizado."); }
    catch(error){setMessage(error instanceof Error?error.message:"Falha na autenticação visitante.");}
  }
  function startGame(){setCurrentPhase(1);setPaused(false);setScreen("playing");}

  return (
    <main className={`app-shell ${screen === "title" ? "title-screen" : "playing-screen"}`}>
      {screen === "title" ? (
        <section className="title-menu">
          <div className="title-atmosphere" aria-hidden="true" />
          <div className="title-content">
            <span className="eyebrow">UM PESADELO ESTÁ APENAS COMEÇANDO</span>
            <h1>SPLATTERHOUSE</h1>
            <p className="title-subtitle">A MANSÃO NÃO DEIXARÁ VOCÊ SAIR.</p>
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
            <div className="account-actions"><span className="save-status">{auth?.currentUser?"Conta conectada":message}</span><button className="secondary" onClick={()=>setPaused(v=>!v)}>{paused?"Continuar":"Pausar"}</button><button className="secondary" onClick={()=>setScreen("title")}>Menu inicial</button></div>
          </header>
          <section className="game-layout">
            <div className="game-frame">
              <GameView paused={paused} onScore={points=>setProgress(p=>({...p,totalScore:p.totalScore+points}))} onKill={()=>setProgress(p=>({...p,totalKills:p.totalKills+1}))} onStageChange={stage=>{setCurrentPhase(stage);setProgress(p=>({...p,currentStage:stage,unlockedStages:[...new Set([...p.unlockedStages,stage])],checkpoint:stage===1?"mansao-exterior-start":"mansao-interior-entry"}));}} />
              <div className="hud">
                <div><small>FASE</small><strong>0{currentPhase}/02</strong></div>
                <div><small>LOCAL</small><strong>{currentPhase===1?"TERRENO":"MANSÃO"}</strong></div>
                <div><small>PONTUAÇÃO</small><strong>{progress.totalScore.toLocaleString("pt-BR")}</strong></div>
              </div>
              {paused&&<div className="pause-overlay"><h2>JOGO PAUSADO</h2><button onClick={()=>setPaused(false)}>CONTINUAR</button><button className="secondary" onClick={()=>setScreen("title")}>MENU INICIAL</button></div>}
            </div>
            <aside className="side-panel">
              <span className="eyebrow">{currentPhase===1?"FASE 01 · EXTERIOR":"FASE 02 · INTERIOR"}</span>
              <h2>{currentPhase===1?"O terreno da mansão":"Dentro da mansão"}</h2>
              <p>{currentPhase===1?"Atravesse o muro gosmento, avance pela área das árvores e alcance a porta principal da mansão.":"Explore o salão da mansão em perspectiva 2,5D. O ambiente interno será expandido com inimigos, objetos e novas rotas."}</p>
              {currentPhase===1?<div className="stage-list"><span className="active">01 · Muro gosmento</span><span>02 · Bosque de árvores</span><span>03 · Frente da mansão</span></div>:<div className="stage-list"><span className="active">01 · Salão principal</span><span>02 · Próximas salas (futuro)</span></div>}
              <div className="stat"><span>Checkpoint</span><b>{progress.checkpoint}</b></div>
              <div className="stat"><span>Eliminações</span><b>{progress.totalKills}</b></div>
              <p className="hint">Mover: WASD ou setas · Atacar: J · Agarrar/arremessar: K · Recolher arma: E</p>
              <p className="hint">Sequência de armas: mãos → cano → facão → escopeta. Aproxime-se de cada arma e pressione E. A entrada da mansão inicia automaticamente a segunda fase.</p>
            </aside>
          </section>
        </>
      )}
      {screen==="playing"&&<footer>BUILD 0.2.0 · FASE 01: ROLAGEM HORIZONTAL · FASE 02: AMBIENTE 2,5D</footer>}
    </main>
  );
}
