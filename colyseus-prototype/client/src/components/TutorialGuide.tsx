import { useState, useEffect, useCallback } from 'react';
import { Emoji } from './Emoji';

const STORAGE_KEY = 'zoo_tutorial_done';

/** チュートリアルのステップ定義 */
const STEPS = [
  {
    id: 'setup',
    title: '動物の初期配置',
    body: 'ゲーム開始時、レッサーパンダとペンギンを好きなケージに配置します。\nケージの番号がサイコロの出目に対応しています。どこに置くかが戦略のカギ！',
    emoji: 'zoo' as const,
  },
  {
    id: 'phasebar',
    title: 'フェーズバー',
    body: '毎ターンは「うんち → サイコロ → 収入 → 買物 → 掃除 → 終了」の順に進みます。\n今どのフェーズにいるかは、上部のバーで確認できます。',
    emoji: 'target' as const,
  },
  {
    id: 'poop',
    title: 'うんちを受け取る',
    body: 'ターン開始時に、うんちトークンを1つ受け取ります。\nうんちは溜まりすぎるとバーストするので注意！',
    emoji: 'poop' as const,
  },
  {
    id: 'dice',
    title: 'サイコロを振る',
    body: 'サイコロは1個(1〜6)か2個(2〜12)を選べます。\n出た目のケージにいる動物の効果が発動し、コインや特殊効果を得られます。',
    emoji: 'dice' as const,
  },
  {
    id: 'trade',
    title: 'お買い物',
    body: 'マーケットから動物をクリックして購入し、空いているケージに配置します。\n不要な動物は返却もできます（半額戻り）。\n買い物が終わったら「お買い物終了」ボタンを押して次へ。',
    emoji: 'cart' as const,
  },
  {
    id: 'clean',
    title: 'うんちの掃除',
    body: 'うんちが7個以上になるとバースト！一番高い動物が返却されてしまいます。\n1コインで2個掃除できるので、溜まりすぎないようにしましょう。',
    emoji: 'broom' as const,
  },
  {
    id: 'endturn',
    title: 'ターン終了',
    body: '掃除が終わると自動で次のプレイヤーのターンに移ります。\n星を3つ集め、うんちが6個以下ならゲームに勝利！',
    emoji: 'star' as const,
  },
] as const;

/** チュートリアル完了済みかチェック */
export function isTutorialDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** チュートリアルガイドコンポーネント */
export function TutorialGuide({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch { /* ignore */ }
    onDone();
  }, [onDone]);

  // Escキーでスキップ
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [finish]);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="tutorial-overlay">
      <div className="tutorial-bubble">
        <div className="tutorial-header">
          <span className="tutorial-step-indicator">
            {step + 1} / {STEPS.length}
          </span>
          <button className="tutorial-skip" onClick={finish}>
            スキップ ✕
          </button>
        </div>

        <div className="tutorial-title">
          <Emoji name={current.emoji} size={24} />
          <span>{current.title}</span>
        </div>

        <div className="tutorial-body">
          {current.body.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>

        <div className="tutorial-nav">
          {step > 0 && (
            <button className="tutorial-btn secondary" onClick={() => setStep(s => s - 1)}>
              ← 戻る
            </button>
          )}
          <div style={{ flexGrow: 1 }} />
          {isLast ? (
            <button className="tutorial-btn primary" onClick={finish}>
              ガイドを閉じる
            </button>
          ) : (
            <button className="tutorial-btn primary" onClick={() => setStep(s => s + 1)}>
              次へ →
            </button>
          )}
        </div>

        {/* 進捗ドット */}
        <div className="tutorial-dots">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`tutorial-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
              onClick={() => setStep(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
