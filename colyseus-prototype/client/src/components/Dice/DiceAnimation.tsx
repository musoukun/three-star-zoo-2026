import { useEffect, useRef, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import DiceMesh from './DiceMesh';
import { Emoji } from '../Emoji';

type DiceAnimationProps = {
  diceResults: number[];
  onComplete: () => void;
  duration?: number;
};

export default function DiceAnimation({ diceResults, onComplete, duration = 0.9 }: DiceAnimationProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // アニメーション完了後 + 結果表示0.8秒
    timerRef.current = setTimeout(() => {
      onComplete();
    }, duration * 1000 + 1000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="dice-animation-overlay">
      <div className="dice-animation-backdrop" />
      <div className="dice-canvas-container">
        <Canvas camera={{ position: [0, 3, 7], fov: 45 }}>
          <ambientLight intensity={1.5} />
          <directionalLight position={[5, 8, 5]} intensity={2} />
          <pointLight position={[-5, 5, -5]} intensity={0.8} />
          <Suspense fallback={null}>
            {diceResults.map((result, i) => (
              <DiceMesh
                key={i}
                result={result}
                index={i}
                total={diceResults.length}
                duration={duration}
              />
            ))}
          </Suspense>
        </Canvas>
      </div>
      <div className="dice-result-text">
        <Emoji name="dice" size={18} />{' '}
        {diceResults.length === 1
          ? diceResults[0]
          : `${diceResults[0]} + ${diceResults[1]} = ${diceResults[0] + diceResults[1]}`}
      </div>
    </div>
  );
}
