import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// 各面の最終回転角度（1〜6）— BoxGeometry面順序: +X, -X, +Y, -Y, +Z, -Z
// three.jsのBoxGeometryのface順: right(+X), left(-X), top(+Y), bottom(-Y), front(+Z), back(-Z)
// 目の配置: 1=top, 2=front, 3=right, 4=left, 5=back, 6=bottom (標準サイコロ)
const DICE_ROTATIONS: Record<number, { x: number; y: number; z: number }> = {
  1: { x: Math.PI / 2, y: 0, z: 0 },               // 1(+Y面)をカメラ側(+Z)に
  2: { x: 0, y: 0, z: 0 },                        // 2を正面に
  3: { x: 0, y: -Math.PI / 2, z: 0 },            // 3を正面に
  4: { x: 0, y: Math.PI / 2, z: 0 },             // 4を正面に
  5: { x: 0, y: Math.PI, z: 0 },                  // 5を正面に
  6: { x: -Math.PI / 2, y: 0, z: 0 },              // 6(-Y面)をカメラ側(+Z)に
};

/** Canvasで各面のテクスチャを生成 */
function createFaceTexture(dots: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // 背景: クリーム色（角丸風）
  ctx.fillStyle = '#fff8e8';
  ctx.fillRect(0, 0, size, size);

  // 枠線
  ctx.strokeStyle = '#c0a060';
  ctx.lineWidth = 8;
  ctx.beginPath();
  const r = 20;
  ctx.roundRect(4, 4, size - 8, size - 8, r);
  ctx.stroke();

  // ドット描画
  const dotR = 22;
  ctx.fillStyle = '#222';
  const positions = getDotPositions(dots, size);
  for (const [x, y] of positions) {
    ctx.beginPath();
    // 1の目だけ赤
    if (dots === 1) ctx.fillStyle = '#e53935';
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function getDotPositions(dots: number, size: number): [number, number][] {
  const s = size;
  const p = 0.26; // 端からの比率
  const c = 0.5;
  const tl: [number, number] = [s * p, s * p];
  const tr: [number, number] = [s * (1 - p), s * p];
  const ml: [number, number] = [s * p, s * c];
  const mc: [number, number] = [s * c, s * c];
  const mr: [number, number] = [s * (1 - p), s * c];
  const bl: [number, number] = [s * p, s * (1 - p)];
  const br: [number, number] = [s * (1 - p), s * (1 - p)];

  switch (dots) {
    case 1: return [mc];
    case 2: return [tr, bl];
    case 3: return [tr, mc, bl];
    case 4: return [tl, tr, bl, br];
    case 5: return [tl, tr, mc, bl, br];
    case 6: return [tl, tr, ml, mr, bl, br];
    default: return [];
  }
}

type DiceMeshProps = {
  result: number;
  index: number;
  total: number;
  duration: number;
};

export default function DiceMesh({ result, index, total, duration }: DiceMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const progressRef = useRef(0);

  // 6面分のマテリアルを生成
  // BoxGeometry face順: +X(3), -X(4), +Y(1), -Y(6), +Z(2), -Z(5)
  const materials = useMemo(() => {
    const faceOrder = [3, 4, 1, 6, 2, 5]; // 標準サイコロ配置
    return faceOrder.map(dots => {
      const tex = createFaceTexture(dots);
      return new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.4,
        metalness: 0.05,
      });
    });
  }, []);

  const target = DICE_ROTATIONS[result];
  const totalSpin = Math.PI * 6;

  const xPos = index * 2.5 - (total - 1) * 1.25;

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    progressRef.current = Math.min(progressRef.current + delta / duration, 1);
    const t = progressRef.current;

    // easeOutCubic
    const ease = 1 - Math.pow(1 - t, 3);

    meshRef.current.rotation.x = totalSpin * (1 - ease) + target.x * ease;
    meshRef.current.rotation.y = totalSpin * 0.7 * (1 - ease) + target.y * ease;
    meshRef.current.rotation.z = totalSpin * 0.5 * (1 - ease) + target.z * ease;

    // バウンド
    const bounce = t < 0.3
      ? Math.sin((t / 0.3) * Math.PI) * 2.5
      : Math.sin(((t - 0.3) / 0.7) * Math.PI * 0.5) * 0.4;
    meshRef.current.position.y = bounce;
  });

  return (
    <mesh ref={meshRef} position={[xPos, 0, 0]} material={materials}>
      <boxGeometry args={[1.6, 1.6, 1.6]} />
    </mesh>
  );
}
