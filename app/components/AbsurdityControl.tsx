import { LEVELS, getLevel } from "@/lib/escalation";
import type { LevelId } from "@/lib/types";

interface Props {
  value: LevelId;
  onChange: (level: LevelId) => void;
  disabled?: boolean;
}

export default function AbsurdityControl({ value, onChange, disabled }: Props) {
  const level = getLevel(value);
  return (
    <div className="absurdity">
      <div className="absurdity-head">
        <label htmlFor="absurdity" className="field-label">
          Absurdity
        </label>
        <span className="absurdity-current">
          <span className="absurdity-num">Level {level.id}</span> {level.label}
        </span>
      </div>
      <input
        id="absurdity"
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) as LevelId)}
        aria-valuetext={`Level ${level.id}: ${level.label}`}
        list="absurdity-levels"
      />
      <datalist id="absurdity-levels">
        {LEVELS.map((l) => (
          <option key={l.id} value={l.id} label={l.label} />
        ))}
      </datalist>
      <div className="absurdity-scale" aria-hidden>
        <span>{LEVELS[0].label}</span>
        <span>{LEVELS[LEVELS.length - 1].label}</span>
      </div>
    </div>
  );
}
