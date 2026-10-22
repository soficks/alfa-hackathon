import { useRef, useState } from 'react';
import { Icon } from './Icon';
import type { DocFile } from '../store/types';
import { fileSize } from '../utils/format';

const SUPPORTED = ['pdf', 'png', 'jpg', 'jpeg', 'xlsx', 'xls', 'csv', 'doc', 'docx'];
const MAX_SIZE = 20 * 1024 * 1024;

interface Props {
  documents: DocFile[];
  onChange: (documents: DocFile[]) => void;
  title?: string;
  /** Файлы, которые нельзя удалить (уже приложены к заявке) */
  locked?: boolean;
}

/** Приём файлов: в прототипе сохраняются только имя и размер. */
export default function UploadBox({ documents, onChange, title = 'Перетащите документы сюда', locked = false }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const addFiles = (files: File[]) => {
    const accepted: DocFile[] = [];
    const problems: string[] = [];
    for (const file of files) {
      if (file.size > MAX_SIZE) problems.push(`«${file.name}»: больше 20 МБ`);
      else if (!SUPPORTED.includes(file.name.split('.').pop()?.toLowerCase() ?? '')) problems.push(`«${file.name}»: неподдерживаемый формат`);
      else accepted.push({ id: crypto.randomUUID(), name: file.name, size: file.size, addedAt: new Date().toISOString() });
    }
    setErrors(problems);
    if (accepted.length) onChange([...documents, ...accepted]);
  };

  return (
    <div className="upload">
      <div
        className={`upload__zone${drag ? ' is-drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles([...e.dataTransfer.files]);
        }}
      >
        <span className="upload__icon">
          <Icon name="upload" size={22} />
        </span>
        <div className="upload__text">
          <strong>{title}</strong>
          <span>PDF, изображения, Word или Excel · до 20 МБ</span>
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => input.current?.click()}>
          Выбрать файлы
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={SUPPORTED.map((e) => `.${e}`).join(',')}
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>

      {errors.map((err) => (
        <p key={err} className="form-error" role="alert">
          {err}
        </p>
      ))}

      {documents.length > 0 && (
        <ul className="doc-list">
          {documents.map((doc) => (
            <li key={doc.id} className="doc-item">
              <Icon name="file" size={20} className="doc-item__icon" />
              <div className="doc-item__text">
                <strong>{doc.name}</strong>
                <span>
                  {fileSize(doc.size)} · {doc.demo ? 'демо-документ' : 'выбран на устройстве'}
                </span>
              </div>
              {!locked && (
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  aria-label={`Удалить ${doc.name}`}
                  onClick={() => onChange(documents.filter((d) => d.id !== doc.id))}
                >
                  <Icon name="trash" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
