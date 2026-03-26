import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// モバイルデバッグ用: URLに ?eruda を付けるとページ内コンソールを表示
if (new URLSearchParams(location.search).has('eruda')) {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/eruda';
  script.onload = () => (window as any).eruda.init();
  document.head.appendChild(script);
}

createRoot(document.getElementById('root')!).render(<App />);
