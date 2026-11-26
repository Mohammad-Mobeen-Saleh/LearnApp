import { useEffect, useRef } from 'react';
import * as Phaser from 'phaser';
import { MeteorScene, type GameBridge } from './MeteorScene.ts';

/**
 * Bettet das Phaser-Spiel in React ein. Die Canvas wird in Gerätepixeln gerendert
 * (scharfe Schrift auf dem iPhone) und folgt automatisch der Grösse des Containers.
 */
export function GameCanvas({ bridge }: { bridge: GameBridge }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // HTML-Ebene für Antwortbeschriftungen (korrekte arabische Schrift und Schreibrichtung)
    bridge.labelLayer = labelsRef.current;
    const dpr = bridge.pixelRatio;
    const size = () => ({
      w: Math.max(1, Math.round(host.clientWidth * dpr)),
      h: Math.max(1, Math.round(host.clientHeight * dpr)),
    });
    const initial = size();
    const scene = new MeteorScene(bridge);
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      transparent: true,
      banner: false,
      disableContextMenu: true,
      scale: {
        mode: Phaser.Scale.NONE,
        width: initial.w,
        height: initial.h,
        zoom: 1 / dpr,
      },
      render: { antialias: true, powerPreference: 'high-performance' },
      input: { keyboard: false, gamepad: false, activePointers: 2 },
      audio: { noAudio: true },
      fps: { target: 60 },
      scene: [scene],
    });

    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = size();
        if (next.w !== game.scale.width || next.h !== game.scale.height) game.scale.resize(next.w, next.h);
        game.scale.updateBounds();
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener('orientationchange', resize);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('orientationchange', resize);
      bridge.detach(scene);
      game.destroy(true);
      bridge.labelLayer = null;
      labelsRef.current?.replaceChildren();
    };
  }, [bridge]);

  return (
    <div className="game-canvas" ref={hostRef}>
      <div className="answer-labels" ref={labelsRef} aria-hidden="true" />
    </div>
  );
}
