/** 3D絵文字画像コンポーネント — 機種間のデザイン統一のため画像で表示 */

// UI系
import poop from '../assets/emoji/poop.png';
import coin from '../assets/emoji/coin.png';
import star from '../assets/emoji/star.png';
import dice from '../assets/emoji/dice.png';
import card from '../assets/emoji/card.png';
import cart from '../assets/emoji/cart.png';
import broom from '../assets/emoji/broom.png';
import check from '../assets/emoji/check.png';
import trophy from '../assets/emoji/trophy.png';
import refresh from '../assets/emoji/refresh.png';
import door from '../assets/emoji/door.png';
import chat from '../assets/emoji/chat.png';
import robot from '../assets/emoji/robot.png';
import fire from '../assets/emoji/fire.png';
import explosion from '../assets/emoji/explosion.png';
import memo from '../assets/emoji/memo.png';
import target from '../assets/emoji/target.png';
import scroll from '../assets/emoji/scroll.png';
import inbox from '../assets/emoji/inbox.png';
import sword from '../assets/emoji/sword.png';
import skip from '../assets/emoji/skip.png';
import hourglass from '../assets/emoji/hourglass.png';
import controller from '../assets/emoji/controller.png';
import lock from '../assets/emoji/lock.png';
import house from '../assets/emoji/house.png';
import people from '../assets/emoji/people.png';
import book from '../assets/emoji/book.png';
import pkg from '../assets/emoji/package.png';
import store from '../assets/emoji/store.png';

// チャンスカード
import forkKnife from '../assets/emoji/fork_knife.png';
import gift from '../assets/emoji/gift.png';
import seedling from '../assets/emoji/seedling.png';
import truck from '../assets/emoji/truck.png';

// 動物
import pandaEmoji from '../assets/emoji/panda.png';
import lionEmoji from '../assets/emoji/lion.png';
import penguinEmoji from '../assets/emoji/penguin.png';
import giraffeEmoji from '../assets/emoji/giraffe.png';
import elephantEmoji from '../assets/emoji/elephant.png';
import parrotEmoji from '../assets/emoji/parrot.png';
import sealEmoji from '../assets/emoji/seal.png';
import leopardEmoji from '../assets/emoji/leopard.png';
import rhinoEmoji from '../assets/emoji/rhino.png';
import dolphinEmoji from '../assets/emoji/dolphin.png';
import pawEmoji from '../assets/emoji/paw.png';

// 色丸
import redCircle from '../assets/emoji/red_circle.png';
import blueCircle from '../assets/emoji/blue_circle.png';
import greenCircle from '../assets/emoji/green_circle.png';
import purpleCircle from '../assets/emoji/purple_circle.png';
import orangeCircle from '../assets/emoji/orange_circle.png';

export const EMOJI: Record<string, string> = {
  // UI
  poop, coin, star, dice, card, cart, broom, check, trophy,
  refresh, door, chat, robot, fire, explosion, memo, target,
  scroll, inbox, sword, skip, hourglass, controller, lock,
  house, people, book, package: pkg, store,
  // チャンスカード
  fork_knife: forkKnife, gift, seedling, truck,
  // 動物
  panda: pandaEmoji, lion: lionEmoji, penguin: penguinEmoji,
  giraffe: giraffeEmoji, elephant: elephantEmoji, parrot: parrotEmoji,
  seal: sealEmoji, leopard: leopardEmoji, rhino: rhinoEmoji,
  dolphin: dolphinEmoji, paw: pawEmoji,
  // 色丸
  red_circle: redCircle, blue_circle: blueCircle,
  green_circle: greenCircle, purple_circle: purpleCircle,
  orange_circle: orangeCircle,
};

/** 色名→色丸画像キー */
export const COLOR_EMOJI: Record<string, string> = {
  RED: 'red_circle',
  BLUE: 'blue_circle',
  GREEN: 'green_circle',
  PURPLE: 'purple_circle',
  ORANGE: 'orange_circle',
};

interface EmojiProps {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Emoji({ name, size = 16, className = '', style }: EmojiProps) {
  const src = EMOJI[name];
  if (!src) return <span>{name}</span>;
  return (
    <img
      src={src}
      alt={name}
      className={`emoji-img ${className}`}
      style={{ width: size, height: size, verticalAlign: 'middle', ...style }}
      draggable={false}
    />
  );
}
