import { useRef, useState } from 'react';
import { Icon } from './Icon';
import Modal from './Modal';
import type { NewDocFile } from '../api';
import { DOC_TYPES } from '../config/docTypes';
import type { DocFile, DocType } from '../domain/types';
import { dateTime, fileSize } from '../utils/format';

const SUPPORTED = ['pdf', 'png', 'jpg', 'jpeg', 'xlsx', 'xls', 'csv', 'doc', 'docx'];
const MAX_SIZE = 20 * 1024 * 1024;

let seq = 0;
export const newDocId = () => `doc-${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Демо-файл нужного типа — без выбора файла на устройстве. */
export function demoFile(docType: DocType, name?: string): NewDocFile {
  return {
    id: newDocId(),
    name: name ?? `${DOC_TYPES[docType].title} (демо).pdf`,
    size: 180_000 + Math.round(Math.random() * 300_000),
    docType,
    addedAt: new Date().toISOString(),
    demo: true,
  };
}

/** Кнопка загрузки с заранее выбранным типом документа. Файлы не читаются: храним имя и размер. */
export function UploadButton({
  docType,
  onFiles,
  label = 'Загрузить',
  variant = 'outline',
  disabled,
  multiple = false,
}: {
  docType: DocType;
  onFiles: (files: NewDocFile[]) => void;
  label?: string;
  variant?: 'outline' | 'primary';
  disabled?: boolean;
  multiple?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="upload-btn-wrap">
      <button type="button" className={`btn btn--${variant} btn--sm`} disabled={disabled} onClick={() => input.current?.click()} aria-label={`${label}: ${DOC_TYPES[docType].title}`}>
        <Icon name="upload" size={16} /> {label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={SUPPORTED.map((e) => `.${e}`).join(',')}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          const bad = files.find((f) => f.size > MAX_SIZE || !SUPPORTED.includes(f.name.split('.').pop()?.toLowerCase() ?? ''));
          if (bad) {
            setError(bad.size > MAX_SIZE ? `«${bad.name}» больше 20 МБ` : `«${bad.name}»: неподдерживаемый формат`);
            return;
          }
          setError(null);
          if (files.length) onFiles(files.map((f) => ({ id: newDocId(), name: f.name, size: f.size, docType, addedAt: new Date().toISOString() })));
        }}
      />
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

const SOURCE_LABEL: Record<DocFile['source'], string> = {
  submission: 'при подаче',
  request: 'по запросу банка',
  later: 'дозагружен',
};

export function DocList({ docs, onOpen, onRemove, showSource = false }: { docs: DocFile[] | NewDocFile[]; onOpen?: (d: DocFile) => void; onRemove?: (id: string) => void; showSource?: boolean }) {
  if (!docs.length) return <p className="muted">Документов пока нет.</p>;
  return (
    <ul className="doc-list">
      {docs.map((d) => (
        <li key={d.id} className="doc-item">
          <Icon name="file" size={20} className="doc-item__icon" />
          <div className="doc-item__text">
            <strong>{d.name}</strong>
            <span>
              {DOC_TYPES[d.docType].title} · {fileSize(d.size)} · {dateTime(d.addedAt)}
              {showSource && 'source' in d ? ` · ${SOURCE_LABEL[d.source]}` : ''}
            </span>
          </div>
          {onOpen && 'source' in d && (
            <button type="button" className="link-btn link-btn--blue" onClick={() => onOpen(d)}>
              Открыть
            </button>
          )}
          {onRemove && (
            <button type="button" className="icon-btn icon-btn--sm" aria-label={`Удалить ${d.name}`} onClick={() => onRemove(d.id)}>
              <Icon name="trash" size={16} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Предпросмотр-заглушка: содержимое файлов в прототипе не хранится. */
export function DocPreview({ doc, onClose }: { doc: DocFile; onClose: () => void }) {
  return (
    <Modal title={doc.name} onClose={onClose}>
      <div className="doc-preview">
        <Icon name="file" size={40} />
        <p>Содержимое файлов в прототипе не хранится — сохраняем только метаданные.</p>
      </div>
      <dl className="kv">
        <dt>Тип</dt>
        <dd>{DOC_TYPES[doc.docType].title}</dd>
        <dt>Размер</dt>
        <dd>{fileSize(doc.size)}</dd>
        <dt>Загружен</dt>
        <dd>
          {dateTime(doc.addedAt)} · {doc.addedBy === 'client' ? 'клиентом' : 'сотрудником'}, {SOURCE_LABEL[doc.source]}
        </dd>
      </dl>
    </Modal>
  );
}
