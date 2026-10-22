import { useEffect, useState, type ComponentProps } from 'react';
import { Icon } from './Icon';
import MascotSlider from './MascotSlider';

type SliderProps = ComponentProps<typeof MascotSlider>;

interface Props extends SliderProps {
  label: string;
  format: (value: number) => string;
  /** Единица в поле ручного ввода */
  unit: string;
}

/** Заголовок с редактируемым числом + ползунок с котом. */
export default function SliderField({ label, format, unit, ...slider }: Props) {
  const { value, min, max, step, onChange } = slider;
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(String(value));

  useEffect(() => setRaw(String(value)), [value]);

  const commit = () => {
    const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round((n - min) / step) * step + min)));
    else setRaw(String(value));
    setEditing(false);
  };

  return (
    <section className="slider-field">
      <h3 className="slider-field__label">{label}</h3>
      {editing ? (
        <span className="slider-field__edit">
          <input
            autoFocus
            inputMode="numeric"
            aria-label={`${label}, ${unit}`}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setRaw(String(value));
                setEditing(false);
              }
            }}
          />
          <span>{unit}</span>
        </span>
      ) : (
        <button type="button" className="slider-field__value" onClick={() => setEditing(true)} title="Нажмите, чтобы ввести точное значение">
          {format(value)}
          <Icon name="pencil" size={18} />
        </button>
      )}
      <MascotSlider {...slider} />
    </section>
  );
}
