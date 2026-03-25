// ===== 動物の色 =====
export type AnimalColor = 'RED' | 'BLUE' | 'GREEN' | 'PURPLE' | 'ORANGE';

// ===== 効果定義 =====
export interface Effect {
  global: boolean;
  timing: 'first' | 'end';
  creation?: number;
  creationIf?: [string, string, string, '?', string, ':', string];
  buff?: [number, string, 'each' | 'once'];
  bonusbuff?: [number, string, 'once'];
  steal?: [number, 'target', ...unknown[]];
  stealIf?: [string, string, string, '?', string, ':', string];
  choice?: ('creation' | 'steal')[];
  adjacent?: [number, string, 'once'];
}

// ===== 動物定義 =====
export interface AnimalDef {
  id: string;
  name: string;
  cost: number;
  poops: number;
  colors: AnimalColor[];
  inventory: number;
  effect: Effect;
}
