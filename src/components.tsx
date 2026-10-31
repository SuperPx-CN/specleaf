import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Copy, FileJson, Link2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  formatValue,
  makeCurl,
  mediaExamples,
  object,
  own,
  resolveObject,
  displaySchema,
  schemaConstraints,
  schemaConstraintSummary,
  schemaEdges,
  schemaType,
  type ApiObject,
  type Example,
  type Operation,
} from './lib/openapi';

export function Markdown({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          img: ({ src, alt }) => (
            <a href={src} target="_blank" rel="noreferrer" className="image-link">
              [图片] {alt || src}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function CopyButton({
  value,
  label = '复制',
  iconOnly = false,
}: {
  value: string;
  label?: string;
  iconOnly?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  const manualText = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (state === 'error') {
      dialog.current?.showModal();
      manualText.current?.focus();
      manualText.current?.select();
    }
  }, [state]);
  async function copy() {
    clearTimeout(timer.current);
    let success = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        success = true;
      }
    } catch { /* Retry using the browser's selection based copy command. */ }
    if (!success) {
      const focused = document.activeElement as HTMLElement | null;
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      try {
        textarea.focus({ preventScroll: true });
        textarea.select();
        success = document.execCommand('copy');
      } catch { /* The manual copy dialog remains available. */ }
      finally {
        textarea.remove();
        focused?.focus({ preventScroll: true });
      }
    }
    setState(success ? 'copied' : 'error');
    if (success) timer.current = setTimeout(() => setState('idle'), 2200);
  }
  return (
    <>
      <button
        type="button"
        className={`copy-button ${iconOnly ? 'icon-only' : ''}`}
        onClick={copy}
        title={label}
        aria-label={label}
      >
        {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
        {(!iconOnly || state !== 'idle') && (
          <span role="status">
            {state === 'copied' ? '已复制' : state === 'error' ? '复制失败' : label}
          </span>
        )}
      </button>
      {state === 'error' && (
        <dialog ref={dialog} className="copy-dialog" aria-label="手动复制" onClose={() => setState('idle')}>
          <h2>手动复制</h2>
          <p>浏览器未允许自动复制。请选择下方文本，按 ⌘C / Ctrl+C 复制。</p>
          <textarea ref={manualText} aria-label="待复制文本" readOnly value={value} />
          <button className="primary-button" onClick={() => dialog.current?.close()}>关闭</button>
        </dialog>
      )}
    </>
  );
}

export function CodeBlock({
  value,
  label = 'JSON',
  copyLabel,
}: {
  value: string;
  label?: string;
  copyLabel?: string;
}) {
  const tokens = value.split(
    /("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b)/g,
  );
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>
          <FileJson size={14} /> {label}
        </span>
        <CopyButton value={value} label={copyLabel || '复制示例'} />
      </div>
      <pre tabIndex={0}>
        <code>
          {tokens.map((token, index) => (
            <span
              key={index}
              className={
                token.startsWith('"')
                  ? token.endsWith(':')
                    ? 'code-key'
                    : 'code-string'
                  : /^(true|false|null|-?\d)/.test(token)
                    ? 'code-value'
                    : undefined
              }
            >
              {token}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function shortValue(value: any) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function SchemaTable({ document, schema }: { document: ApiObject; schema: any }) {
  return (
    <div className="schema-table" role="table" aria-label="数据模型字段">
      <div className="schema-head" role="row">
        <span role="columnheader">字段名称</span>
        <span role="columnheader">类型</span>
        <span role="columnheader">必填</span>
        <span role="columnheader">说明与约束</span>
      </div>
      <SchemaRow
        document={document}
        schema={schema}
        name="根节点"
        depth={0}
        required={false}
        initialOpen
      />
    </div>
  );
}

function SchemaRow({
  document,
  schema: raw,
  name,
  required,
  depth,
  initialOpen = false,
}: {
  document: ApiObject;
  schema: any;
  name: string;
  required: boolean;
  depth: number;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const view = displaySchema(document, raw);
  const schema = object(view.schema);
  const reference = view.references[0];
  const recursive = view.recursiveReferences.length > 0;
  const edges = depth >= 32 ? [] : schemaEdges(document, view.schema);
  const constraints = schemaConstraints(document, view.schema);
  const summary = schemaConstraintSummary(document, view.schema);
  const modelName = reference
    ? decodeURIComponent(reference.split('/').at(-1)!).replace(/~1/g, '/').replace(/~0/g, '~')
    : undefined;
  return (
    <>
      <div className={`schema-row ${depth === 0 ? 'schema-root' : ''}`} role="row">
        <div
          role="cell"
          className="field-name"
          style={{ paddingLeft: Math.min(depth, 6) * 16 + 12 }}
        >
          {edges.length ? (
            <button
              type="button"
              className="expand-field"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-label={`${open ? '收起' : '展开'} ${name}`}
            >
              <ChevronRight size={14} className={open ? 'rotated' : ''} />
            </button>
          ) : (
            <span className="field-spacer" />
          )}
          <code title={name}>{name}</code>
        </div>
        <div role="cell" className="field-type">
          <code>{schemaType(document, view.schema)}</code>
          {modelName && <span title={reference}>↗ {modelName}</span>}
        </div>
        <div role="cell">
          {required ? <span className="required">必填</span> : <span className="optional">—</span>}
        </div>
        <div role="cell" className="field-description">
          {schema.title && <strong>{schema.title}</strong>}
          <Markdown>{schema.description}</Markdown>
          {recursive && <span className="reference-note">递归引用 · {view.recursiveReferences.join('、')}</span>}
          {depth >= 32 && <span className="reference-note">已达到展示深度上限</span>}
          {summary.length > 0 && (
            <div className="constraint-summary">
              {summary.map(([label, value]) => (
                <span key={label}>{label}：<code>{shortValue(value)}</code></span>
              ))}
            </div>
          )}
          {constraints.length > 0 && (
            <details className="constraint-details">
              <summary>详细校验规则</summary>
              <div className="constraints">
                {constraints.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}：</span>
                    <code>{shortValue(value)}</code>
                  </div>
                ))}
              </div>
            </details>
          )}
          {view.combinationConstraints.length > 0 && (
            <details className="constraint-details">
              <summary>组合约束</summary>
              {view.notices.map((notice) => <p key={notice}>{notice}</p>)}
              <div className="constraints">
                {view.combinationConstraints.map((source, index) => (
                  <div key={index}>
                    <span>来源 {index + 1}：</span>
                    <code>{JSON.stringify(source, null, 2)}</code>
                  </div>
                ))}
              </div>
            </details>
          )}
          {!schema.title && !schema.description && !constraints.length && !recursive && !view.notices.length && (
            <span className="muted">—</span>
          )}
        </div>
      </div>
      {open &&
        edges.map((edge, index) => (
          <SchemaRow
            key={`${edge.name}-${index}`}
            {...edge}
            document={document}
            depth={depth + 1}
          />
        ))}
    </>
  );
}

export function MediaPanel({
  document,
  content,
  operation,
}: {
  document: ApiObject;
  content: ApiObject;
  operation?: Operation;
}) {
  const types = Object.keys(content);
  const [selectedType, setSelectedType] = useState(types[0] || '');
  const [exampleIndex, setExampleIndex] = useState(0);
  const [codeTab, setCodeTab] = useState('example');
  const mediaType = types.includes(selectedType) ? selectedType : types[0];
  const media = resolveObject(document, content[mediaType]);
  const examples = mediaExamples(document, media);
  const example: Example | undefined = examples[exampleIndex] ?? examples[0];
  const hasValue = example && own(example, 'value');
  return (
    <div className="media-panel">
      {types.length > 0 && (
        <div className="media-controls">
          <label>
            媒体类型
            <select
              aria-label={operation ? '请求媒体类型' : '响应媒体类型'}
              value={mediaType}
              onChange={(event) => {
                setSelectedType(event.target.value);
                setExampleIndex(0);
              }}
            >
              {types.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <span className="source-note">以契约定义为准</span>
        </div>
      )}
      {own(media, 'schema') && <SchemaTable document={document} schema={media.schema} />}
      {media.encoding && <RawDetails title="编码规则 · encoding" value={media.encoding} />}
      <div className="example-heading">
        <div className="small-tabs">
          <button
            type="button"
            className={codeTab === 'example' ? 'active' : ''}
            onClick={() => setCodeTab('example')}
          >
            原始示例
          </button>
          {operation && (
            <button
              type="button"
              className={codeTab === 'curl' ? 'active' : ''}
              onClick={() => setCodeTab('curl')}
            >
              cURL
            </button>
          )}
        </div>
        {examples.length > 0 && (
          <select
            aria-label={operation ? '请求示例' : '响应示例'}
            value={Math.min(exampleIndex, examples.length - 1)}
            onChange={(event) => setExampleIndex(Number(event.target.value))}
          >
            {examples.map((item, index) => (
              <option key={index} value={index}>
                {item.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {codeTab === 'curl' && operation ? (
        <>
          <CodeBlock
            label="cURL · 请求模板"
            copyLabel="复制 cURL"
            value={makeCurl(document, operation, mediaType, example)}
          />
          <p className="helper-text">
            使用契约中的服务地址；相对地址及花括号占位符需按实际部署和凭据替换。此处仅复制，不发送请求。
          </p>
        </>
      ) : (
        <>
          {example?.description && <Markdown>{example.description}</Markdown>}
          {hasValue ? (
            <CodeBlock
              value={formatValue(example.value, mediaType)}
              label={mediaType || '原始示例'}
            />
          ) : example?.externalValue ? (
            <div className="empty-note">
              <Link2 size={16} />
              <span>
                契约使用外部示例（未加载）：<code>{example.externalValue}</code>
              </span>
            </div>
          ) : (
            <div className="empty-note">
              <FileJson size={17} />
              <span>契约未提供原始示例</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ParameterTable({
  document,
  parameters,
}: {
  document: ApiObject;
  parameters: ApiObject[];
}) {
  return (
    <>
      <div className="schema-table" role="table" aria-label="参数字段">
        <div className="schema-head" role="row">
          <span role="columnheader">参数名称</span>
          <span role="columnheader">类型</span>
          <span role="columnheader">必填</span>
          <span role="columnheader">说明与约束</span>
        </div>
        {parameters.map((parameter) => (
          <SchemaRow
            key={`${parameter.in}:${parameter.name}`}
            document={document}
            name={parameter.name}
            required={parameter.in === 'path' || !!parameter.required}
            depth={0}
            schema={{
              allOf: [
                parameter.schema ?? Object.values(object(parameter.content))[0]?.schema,
                {
                  ...(parameter.description ? { description: parameter.description } : {}),
                  ...(parameter.deprecated ? { deprecated: true } : {}),
                },
              ],
            }}
          />
        ))}
      </div>
      {parameters.map((parameter) => (
        <div key={parameter.name}>
          {['style', 'explode', 'allowEmptyValue', 'allowReserved'].some((key) =>
            own(parameter, key),
          ) && (
            <div className="parameter-serialization">
              <code>{parameter.name}</code>
              {['style', 'explode', 'allowEmptyValue', 'allowReserved']
                .filter((key) => own(parameter, key))
                .map((key) => (
                  <span key={key}>
                    {key}: <code>{String(parameter[key])}</code>
                  </span>
                ))}
            </div>
          )}
          {(own(parameter, 'example') || parameter.examples) && (
            <details className="raw-details">
              <summary>{parameter.name} · 参数示例</summary>
              <MediaPanel document={document} content={{ 'application/json': parameter }} />
            </details>
          )}
          {parameter.content && (
            <details className="raw-details">
              <summary>{parameter.name} · 参数内容</summary>
              <MediaPanel document={document} content={parameter.content} />
            </details>
          )}
        </div>
      ))}
    </>
  );
}

export function RawDetails({ title, value }: { title: string; value: any }) {
  return (
    <details className="raw-details">
      <summary>{title}</summary>
      <CodeBlock value={formatValue(value)} />
    </details>
  );
}

export function Section({
  id,
  title,
  subtitle,
  children,
  badge,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <section id={id} className="doc-section">
      <div className="section-heading">
        <h2>{title}</h2>
        {badge}
        {subtitle && <span>{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}
