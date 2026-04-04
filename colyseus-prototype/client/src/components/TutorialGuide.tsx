import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'zoo_tutorial_done';

/** ガイド対象のフェーズとdata-tutorial属性の対応 */
type GuideStep = {
  phase: string;           // state.phase or turnStep に対応
  target: string;          // data-tutorial 属性値
  title: string;
  body: string;
};

const GUIDE_STEPS: GuideStep[] = [
  {
    phase: 'setup',
    target: 'cage-grid',
    title: '🦁 動物の初期配置',
    body: 'レッサーパンダとペンギンを好きなケージに配置しましょう。ケージの番号がサイコロの出目に対応しています。',
  },
  {
    phase: 'poop',
    target: 'progress-bar',
    title: '📊 フェーズバー',
    body: '毎ターンは「うんち → サイコロ → 収入 → 買物 → 掃除 → 終了」の順に進みます。今どのフェーズかはこのバーで確認できます。',
  },
  {
    phase: 'poop',
    target: 'btn-poop',
    title: '💩 うんちを受け取る',
    body: 'ターン開始時に、うんちトークンを1つ受け取ります。このボタンを押してください。うんちは溜まりすぎるとバーストするので注意！',
  },
  {
    phase: 'roll',
    target: 'btn-roll',
    title: '🎲 サイコロを振る',
    body: 'サイコロは1個（1〜6）か2個（2〜12）を選べます。出た目のケージにいる動物の効果が発動し、コインや特殊効果を得られます。',
  },
  {
    phase: 'trade',
    target: 'btn-trade',
    title: '🛒 お買い物',
    body: '右のマーケットから動物をクリックして購入し、空いているケージに配置します。動物を返却することもできます（半額戻り）。買い物が終わったら「お買い物終了」ボタンを押して次へ。',
  },
  {
    phase: 'clean',
    target: 'btn-clean',
    title: '🧹 うんちの掃除',
    body: 'うんちが7個以上になるとバースト！一番高い動物が返却されてしまいます。1コインで2個掃除できます。掃除が終わったら「掃除終了」を押してください。',
  },
];

/** チュートリアル完了済みかチェック */
export function isTutorialDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** フェーズ連動型チュートリアルガイド */
export function TutorialGuide({
  currentPhase,
  turnStep,
  isMyTurn,
  onDone,
}: {
  currentPhase: string;   // 'setup' | 'main' | 'ended'
  turnStep: string;       // 'poop' | 'roll' | 'income' | 'trade' | 'clean' | 'flush'
  isMyTurn: boolean;
  onDone: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [bubblePos, setBubblePos] = useState<{ top: number; left: number; arrowDir: 'down' | 'up' } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const prevPhaseKey = useRef('');

  const finish = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* */ }
    onDone();
  }, [onDone]);

  // 現在のフェーズキーを算出
  const phaseKey = currentPhase === 'setup' ? 'setup' : turnStep;

  // フェーズが変わったら対応するガイドステップを表示
  useEffect(() => {
    if (!isMyTurn) {
      setVisible(false);
      return;
    }

    if (phaseKey === prevPhaseKey.current) return;
    prevPhaseKey.current = phaseKey;

    // 現在のphaseKeyに一致する最初のガイドを探す（stepIndex以降で）
    const nextIdx = GUIDE_STEPS.findIndex((s, i) => i >= stepIndex && s.phase === phaseKey);
    if (nextIdx >= 0) {
      setStepIndex(nextIdx);
      setVisible(true);
    } else {
      // 全ステップ完了
      setVisible(false);
    }
  }, [phaseKey, isMyTurn, stepIndex]);

  // 対象要素の位置を取得して吹き出しを配置
  useEffect(() => {
    if (!visible) return;
    const step = GUIDE_STEPS[stepIndex];
    if (!step) return;

    const positionBubble = () => {
      const target = document.querySelector(`[data-tutorial="${step.target}"]`);
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const bubbleHeight = bubbleRef.current?.offsetHeight ?? 180;
      const bubbleWidth = bubbleRef.current?.offsetWidth ?? 360;

      // ターゲットの上に出すか下に出すか
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;

      let top: number;
      let arrowDir: 'down' | 'up';
      if (spaceAbove > spaceBelow && spaceAbove > bubbleHeight + 20) {
        // 上に配置
        top = rect.top - bubbleHeight - 12;
        arrowDir = 'down';
      } else {
        // 下に配置
        top = rect.bottom + 12;
        arrowDir = 'up';
      }

      // 水平: ターゲット中央に寄せつつ画面内に収める
      let left = rect.left + rect.width / 2 - bubbleWidth / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - bubbleWidth - 8));

      setBubblePos({ top, left, arrowDir });

      // ターゲットをハイライト
      target.classList.add('tutorial-highlight');
      return () => target.classList.remove('tutorial-highlight');
    };

    // DOMレンダリング後に位置計算
    const timer = setTimeout(positionBubble, 50);
    const cleanup = positionBubble();

    return () => {
      clearTimeout(timer);
      cleanup?.();
      // 旧ターゲットのハイライト解除
      document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
    };
  }, [visible, stepIndex]);

  // 「了解」押下: 同フェーズ内に次ステップがあればそれへ、なければ非表示にして次フェーズ待ち
  const handleNext = () => {
    const nextIdx = stepIndex + 1;
    if (nextIdx >= GUIDE_STEPS.length) {
      finish();
      return;
    }
    const nextStep = GUIDE_STEPS[nextIdx];
    if (nextStep.phase === GUIDE_STEPS[stepIndex].phase) {
      // 同フェーズ内の次ステップ
      setStepIndex(nextIdx);
    } else {
      // 次フェーズ待ち
      setStepIndex(nextIdx);
      setVisible(false);
    }
  };

  // Escでスキップ
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [finish]);

  if (!visible) return null;

  const step = GUIDE_STEPS[stepIndex];
  if (!step) return null;

  const isLastGuide = stepIndex >= GUIDE_STEPS.length - 1 ||
    GUIDE_STEPS.slice(stepIndex + 1).every(s => s.phase === step.phase) && stepIndex === GUIDE_STEPS.length - 1;

  return (
    <>
      {/* 半透明オーバーレイ（ハイライト要素以外を暗く） */}
      <div className="tutorial-dim" onClick={finish} />

      {/* 吹き出し */}
      <div
        ref={bubbleRef}
        className={`tutorial-bubble ${bubblePos?.arrowDir === 'up' ? 'arrow-up' : 'arrow-down'}`}
        style={bubblePos ? {
          position: 'fixed',
          top: bubblePos.top,
          left: bubblePos.left,
          zIndex: 9002,
        } : {
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9002,
        }}
      >
        <div className="tutorial-header">
          <span className="tutorial-step-indicator">
            {stepIndex + 1} / {GUIDE_STEPS.length}
          </span>
          <button className="tutorial-skip" onClick={finish}>
            スキップ ✕
          </button>
        </div>

        <div className="tutorial-title">{step.title}</div>

        <div className="tutorial-body">
          {step.body.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>

        <div className="tutorial-nav">
          <div style={{ flexGrow: 1 }} />
          <button className="tutorial-btn primary" onClick={handleNext}>
            {isLastGuide ? 'ガイドを閉じる' : '了解 →'}
          </button>
        </div>
      </div>
    </>
  );
}
