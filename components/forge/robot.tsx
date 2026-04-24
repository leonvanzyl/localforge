"use client";

import React from "react";

type RobotProps = {
  seed?: number;
  size?: number;
  running?: boolean;
  color?: string;
  style?: React.CSSProperties;
};

const palette = ["#f3dcb4", "#e8c9a4", "#d9c3a5", "#c8d9c0", "#d8c7d3", "#c6d2dc"];

function rng(s: number): number {
  const x = Math.sin(s * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function jitter(seed: number, index: number, amount: number = 0.8): number {
  return (rng(seed + index * 7) - 0.5) * amount * 2;
}

export const Robot: React.FC<RobotProps> = ({
  seed = 0,
  size = 48,
  running = false,
  color,
  style,
}) => {
  const bodyColor = color ?? palette[Math.abs(seed) % palette.length];
  const antennaVariant = Math.abs(seed) % 3;
  const eyeVariant = Math.abs(seed) % 3;

  // Hand-drawn wobbly head rectangle
  const hx = 10;
  const hy = 14;
  const hw = 28;
  const hh = 24;

  const j = (i: number) => jitter(seed, i);

  const headPath = [
    `M ${hx + j(0)} ${hy + j(1)}`,
    `L ${hx + hw + j(2)} ${hy + j(3)}`,
    `L ${hx + hw + j(4)} ${hy + hh + j(5)}`,
    `L ${hx + j(6)} ${hy + hh + j(7)}`,
    `Z`,
  ].join(" ");

  // Antenna rendering
  const renderAntenna = () => {
    const ax = 24;
    const ay = 14;

    switch (antennaVariant) {
      case 0:
        // Straight with circle tip
        return (
          <>
            <line
              x1={ax}
              y1={ay}
              x2={ax}
              y2={5}
              stroke="#888"
              strokeWidth={1.2}
              strokeLinecap="round"
            />
            <circle cx={ax} cy={4} r={2} fill={bodyColor} stroke="#888" strokeWidth={1} />
          </>
        );
      case 1:
        // Zigzag / L-shaped
        return (
          <path
            d={`M ${ax} ${ay} L ${ax} 9 L ${ax + 5} 5`}
            stroke="#888"
            strokeWidth={1.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        );
      case 2:
        // Curly (quadratic bezier)
        return (
          <path
            d={`M ${ax} ${ay} Q ${ax - 4} 6 ${ax + 3} 4`}
            stroke="#888"
            strokeWidth={1.2}
            strokeLinecap="round"
            fill="none"
          />
        );
      default:
        return null;
    }
  };

  // Eye rendering
  const renderEyes = () => {
    const ey = 23;
    const elx = 18;
    const erx = 30;

    switch (eyeVariant) {
      case 0:
        // Two circles
        return (
          <>
            <circle cx={elx} cy={ey} r={2.5} fill="#333" />
            <circle cx={erx} cy={ey} r={2.5} fill="#333" />
          </>
        );
      case 1:
        // Two small squares
        return (
          <>
            <rect x={elx - 2} y={ey - 2} width={4} height={4} rx={0.5} fill="#333" />
            <rect x={erx - 2} y={ey - 2} width={4} height={4} rx={0.5} fill="#333" />
          </>
        );
      case 2:
        // Happy arc eyes
        return (
          <>
            <path
              d={`M ${elx - 2.5} ${ey + 1} A 2.5 2.5 0 0 1 ${elx + 2.5} ${ey + 1}`}
              stroke="#333"
              strokeWidth={1.6}
              strokeLinecap="round"
              fill="none"
            />
            <path
              d={`M ${erx - 2.5} ${ey + 1} A 2.5 2.5 0 0 1 ${erx + 2.5} ${ey + 1}`}
              stroke="#333"
              strokeWidth={1.6}
              strokeLinecap="round"
              fill="none"
            />
          </>
        );
      default:
        return null;
    }
  };

  // Speaker grille mouth (horizontal lines)
  const renderMouth = () => {
    const my = 32;
    const mx = 19;
    const mw = 10;

    return (
      <>
        <line x1={mx} y1={my} x2={mx + mw} y2={my} stroke="#999" strokeWidth={0.8} strokeLinecap="round" />
        <line x1={mx} y1={my + 2.5} x2={mx + mw} y2={my + 2.5} stroke="#999" strokeWidth={0.8} strokeLinecap="round" />
        <line x1={mx} y1={my + 5} x2={mx + mw} y2={my + 5} stroke="#999" strokeWidth={0.8} strokeLinecap="round" />
      </>
    );
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      style={style}
    >
      {/* Antenna */}
      {renderAntenna()}

      {/* Head (hand-drawn wobbly rectangle) */}
      <path
        d={headPath}
        fill={bodyColor}
        stroke="#888"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />

      {/* Ear bolts */}
      <circle cx={hx - 1.5} cy={hy + hh / 2} r={1.8} fill="#ccc" stroke="#999" strokeWidth={0.6} />
      <circle cx={hx + hw + 1.5} cy={hy + hh / 2} r={1.8} fill="#ccc" stroke="#999" strokeWidth={0.6} />

      {/* Eye screen (rounded rect inside head) */}
      <rect
        x={hx + 4}
        y={hy + 4}
        width={hw - 8}
        height={hh / 2 - 2}
        rx={3}
        fill="rgba(255,255,255,0.3)"
        stroke="#aaa"
        strokeWidth={0.6}
      />

      {/* Eyes */}
      {renderEyes()}

      {/* Mouth (speaker grille) */}
      {renderMouth()}

      {/* Running blush on cheeks */}
      {running && (
        <>
          <circle cx={hx + 4} cy={28} r={2.5} fill="#f5a623" opacity={0.45} />
          <circle cx={hx + hw - 4} cy={28} r={2.5} fill="#f5a623" opacity={0.45} />
        </>
      )}
    </svg>
  );
};

export const MiniRobot: React.FC<Omit<RobotProps, "size">> = (props) => (
  <Robot size={24} {...props} />
);
