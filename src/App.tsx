import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Command,
  Database,
  ExternalLink,
  FileText,
  Folder,
  Globe2,
  Hash,
  KeyRound,
  Layers3,
  Link2,
  ListFilter,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import document from 'virtual:openapi';
import {
  CodeBlock,
  CopyButton,
  Markdown,
  MediaPanel,
  ParameterTable,
  RawDetails,
  Section,
} from './components';
import {
  collectOperations,
  collectTags,
  formatValue,
  makeCurl,
  matchesOperation,
  METHODS,
  object,
  operationHash,
  operationIdFromHash,
  resolveObject,
  type ApiObject,
  type Operation,
} from './lib/openapi';

const operations = collectOperations(document);
const tags = collectTags(document, operations);
const initialExpanded = () => new Set<string>([]);
const icons = [KeyRound, ShieldCheck, Database, Layers3, Globe2, Code2, FileText, Hash];
const overviewOutline = [
  ['introduction', '文档概览'], ['quickstart', '开始使用'],
  ['groups', '接口分组'], ['conventions', '通用约定'],
];
const operationOutline = [
  ['description', '接口说明'], ['authentication', '身份认证'],
  ['parameters', '请求参数'], ['request', '请求体与示例'],
  ['responses', '返回响应'], ['policies', '操作策略'],
];

export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [query, setQuery] = useState('');
  const [method, setMethod] = useState('');
  const [expanded, setExpanded] = useState(initialExpanded);
  const [drawer, setDrawer] = useState(false);
  const [activeSection, setActiveSection] = useState('introduction');
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 800px)').matches);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedId = operationIdFromHash(hash);
  const selected = operations.find((operation) => operation.id === selectedId);
  const unknown =
    hash !== '' && hash !== '#' && hash !== '#/' && hash !== '#/overview' && !selected;
  const outline = unknown ? [] : selected ? operationOutline : overviewOutline;
  const filtered = useMemo(
    () => operations.filter((operation) => matchesOperation(operation, query, method)),
    [query, method],
  );
  const filtering = !!query.trim() || !!method;
  useEffect(() => {
    const media = window.matchMedia('(max-width: 800px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const update = () => {
      setHash(window.location.hash);
      setDrawer(false);
      window.scrollTo(0, 0);
      window.document.getElementById('main')?.focus({ preventScroll: true });
    };
    window.addEventListener('hashchange', update);
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setDrawer(true);
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('keydown', keyboard);
    };
  }, []);
  useEffect(() => {
    window.document.title = selected
      ? `${selected.definition.summary || selected.path} · ${document.info.title}`
      : `${document.info.title} · API 文档`;
    if (selected) setExpanded((previous) => new Set([...previous, ...selected.tags]));
  }, [selected]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      const threshold = (window.document.querySelector('.topbar')?.getBoundingClientRect().height || 66) + 32;
      let current = outline[0]?.[0] || '';
      for (const [id] of outline) {
        const section = window.document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= threshold) current = id;
      }
      if (window.scrollY > 0 && window.innerHeight + window.scrollY >= window.document.documentElement.scrollHeight - 2)
        current = outline.at(-1)?.[0] || current;
      setActiveSection(current);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [selected, unknown]);
  useEffect(() => {
    if (!drawer) return;
    const previous = window.document.body.style.overflow;
    if (window.matchMedia('(max-width: 800px)').matches)
      window.document.body.style.overflow = 'hidden';
    const sidebar = window.document.querySelector<HTMLElement>('.sidebar');
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !window.matchMedia('(max-width: 800px)').matches || !sidebar)
        return;
      const focusables = [
        ...sidebar.querySelectorAll<HTMLElement>('button, a, input, select'),
      ].filter((element) => element.offsetParent !== null);
      const first = focusables[0];
      const last = focusables.at(-1);
      if (event.shiftKey && window.document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && window.document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    searchRef.current?.focus();
    window.addEventListener('keydown', onKey);
    return () => {
      window.document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
      if (sidebar?.contains(window.document.activeElement))
        window.document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus();
    };
  }, [drawer]);
  function toggle(tag: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
  }
  function openTag(tag: string) {
    setQuery('');
    setMethod('');
    setExpanded((previous) => new Set(previous).add(tag));
    const first = operations.find((operation) => operation.tags.includes(tag));
    if (first) window.location.hash = operationHash(first);
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([formatValue(document)], { type: 'application/json' }),
    );
    const link = window.document.createElement('a');
    link.href = url;
    link.download = 'openapi.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          window.document.getElementById('main')?.focus({ preventScroll: true });
        }}
      >
        跳转到正文
      </a>
      <header className="topbar">
        <button
          className="mobile-menu icon-button"
          aria-label="打开接口目录"
          onClick={() => setDrawer(true)}
        >
          <Menu size={21} />
        </button>
        <a className="brand" href="#/overview">
          <span className="brand-symbol">
            <Code2 size={23} strokeWidth={2.5} />
          </span>
          <span className="brand-name" title={document.info.title}>
            {document.info.title}
          </span>
        </a>
        <nav className="top-nav" aria-label="主导航">
          <a className="active" href="#/overview">
            API 文档
          </a>
          <button onClick={download}>
            <ArrowDownToLine size={15} /> 导出 OpenAPI
          </button>
        </nav>
        <div className="header-right">
          <span className="version-pill">
            <span />
            {document.info.version || '未指定版本'}
          </span>
          <a className="help-link" href="#/overview" aria-label="文档概览">
            <CircleHelp size={19} />
          </a>
        </div>
      </header>
      {drawer && (
        <button
          className="drawer-backdrop"
          aria-label="关闭接口目录"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside
        className={`sidebar ${drawer ? 'drawer-open' : ''}`}
        aria-label="接口目录"
        inert={mobile && !drawer}
      >
        <div className="sidebar-tools">
          <div className="workspace-label">
            <span className="workspace-icon">
              <Layers3 size={17} />
            </span>
            <div>
              <strong>{document.info.title}</strong>
              <span>接口参考手册</span>
            </div>
            <button
              className="close-drawer icon-button"
              onClick={() => setDrawer(false)}
              aria-label="关闭目录"
            >
              <X size={19} />
            </button>
            <ChevronDown size={14} className="desktop-chevron" />
          </div>
          <div className="search-box">
            <Search size={16} />
            <input
              ref={searchRef}
              aria-label="搜索接口"
              placeholder="搜索接口、路径或关键词"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            ) : (
              <kbd>
                <Command size={10} /> K
              </kbd>
            )}
          </div>
          <div className="method-filter">
            <ListFilter size={13} />
            <select
              aria-label="筛选请求方法"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              <option value="">全部请求方法</option>
              {METHODS.map((value) => (
                <option key={value} value={value}>
                  {value.toUpperCase()}
                </option>
              ))}
            </select>
            <span>{filtered.length} 个接口</span>
          </div>
        </div>
        <nav className="sidebar-scroll" aria-label="接口分组">
          <a
            className={`overview-link ${!selected && !unknown ? 'selected' : ''}`}
            href="#/overview"
            onClick={() => setDrawer(false)}
          >
            <BookOpen size={17} />
            文档概览
            <ChevronRight size={14} />
          </a>
          <div className="nav-caption">
            接口目录 <span>{tags.length} 个分组</span>
          </div>
          {tags.map((tag) => {
            const items = filtered.filter((operation) => operation.tags.includes(tag));
            if (filtering && !items.length) return null;
            const open = filtering || expanded.has(tag);
            return (
              <div className="nav-group" key={tag}>
                <button className="group-toggle" onClick={() => toggle(tag)} aria-expanded={open}>
                  <ChevronRight size={13} className={open ? 'rotated' : ''} />
                  <Folder size={15} />
                  <span title={tag}>{tag}</span>
                  <span className="group-count">{items.length}</span>
                </button>
                {open && (
                  <div className="group-operations">
                    {items.map((operation) => (
                      <a
                        key={operation.id}
                        href={operationHash(operation)}
                        className={`operation-link ${selected?.id === operation.id ? 'selected' : ''}`}
                        onClick={() => setDrawer(false)}
                        title={`${operation.method.toUpperCase()} ${operation.path}`}
                      >
                        <span className={`method method-${operation.method}`}>
                          {operation.method.toUpperCase()}
                        </span>
                        <span>{operation.definition.summary || operation.path}</span>
                        {operation.definition.deprecated && (
                          <span className="deprecated-dot" title="已弃用" />
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {operations.length === 0 ? (
            <div className="search-empty"><FileText size={25} /><strong>当前契约暂无接口定义</strong></div>
          ) : filtered.length === 0 && (
            <div className="search-empty">
              <Search size={25} />
              <strong>没有找到相关接口</strong>
              <span>试试其他关键词或请求方法</span>
              <button
                onClick={() => {
                  setQuery('');
                  setMethod('');
                }}
              >
                清除筛选
              </button>
            </div>
          )}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          契约驱动 · 静态文档<span>OAS {document.openapi}</span>
        </div>
      </aside>
      <div className="page-shell">
        <main id="main" tabIndex={-1}>
          <div className="breadcrumb">
            <span>开发者文档</span>
            <ChevronRight size={13} />
            <span>API 文档</span>
            {selected && (
              <>
                <ChevronRight size={13} />
                <span>{selected.tags[0]}</span>
              </>
            )}
          </div>
          {unknown ? (
            <div className="not-found">
              <FileText size={40} />
              <h1>未找到该接口</h1>
              <p>链接中的接口可能已在契约更新后移除。</p>
              <a href="#/overview">
                返回文档概览 <ArrowRight size={15} />
              </a>
            </div>
          ) : selected ? (
            <OperationDetail key={selected.id} operation={selected} />
          ) : (
            <Overview onOpenTag={openTag} onDownload={download} />
          )}
          <footer className="page-footer">
            <span>{document.info.title} · API Reference</span>
            <span>
              基于 OpenAPI {document.openapi}
              <span className="footer-dot">·</span>版本 {document.info.version || '未指定'}
            </span>
          </footer>
        </main>
        <aside className="page-outline" aria-label="本页目录">
          <span>本页目录</span>
          {outline.map(([id, label]) => (
            <button
              key={id}
              className={activeSection === id ? 'current' : ''}
              aria-current={activeSection === id ? 'location' : undefined}
              onClick={() =>
                window.document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              {label}
            </button>
          ))}
          <div className="outline-note">
            <ShieldCheck size={19} />
            <strong>以接口契约为准</strong>
            <p>字段、示例与操作策略均来自当前版本的 API 契约。</p>
          </div>
        </aside>
      </div>
    </>
  );
}

function Overview({
  onOpenTag,
  onDownload,
}: {
  onOpenTag: (tag: string) => void;
  onDownload: () => void;
}) {
  const exampleOperation = operations[0];
  return (
    <>
      <section id="introduction" className="overview-hero">
        <div className="eyebrow">
          <span /> API REFERENCE <span className="hero-badge">中文文档</span>
        </div>
        <h1>
          {document.info.title}
          <span className="heading-mark">.</span>
        </h1>
        {document.info.summary && <p className="hero-lead">{document.info.summary}</p>}
        <Markdown>{document.info.description}</Markdown>
        <div className="hero-actions">
          <button
            className="primary-button"
            disabled={!operations.length}
            onClick={() => exampleOperation && onOpenTag(exampleOperation.tags[0])}
          >
            <BookOpen size={16} />
            浏览接口
            <ArrowRight size={16} />
          </button>
          <button className="secondary-button" onClick={onDownload}>
            <ArrowDownToLine size={16} />
            导出 OpenAPI
          </button>
          <span>
            <Check size={13} /> YAML / JSON 契约
          </span>
        </div>
      </section>
      <div className="stats-grid">
        <div>
          <span className="stat-icon purple">
            <Code2 size={20} />
          </span>
          <div>
            <strong>
              {operations.length}
              <small>个</small>
            </strong>
            <span>接口定义</span>
          </div>
        </div>
        <div>
          <span className="stat-icon blue">
            <Folder size={20} />
          </span>
          <div>
            <strong>
              {tags.length}
              <small>个</small>
            </strong>
            <span>接口分组</span>
          </div>
        </div>
        <div>
          <span className="stat-icon green">
            <ShieldCheck size={20} />
          </span>
          <div>
            <strong>{document.openapi}</strong>
            <span>OpenAPI 规范</span>
          </div>
        </div>
      </div>
      <Section id="quickstart" title="开始使用" subtitle="三步了解你的第一个接口">
        <div className="getting-started">
          <div className="start-steps">
            <div>
              <span>01</span>
              <div>
                <strong>找到需要的接口</strong>
                <p>按业务目录浏览，或使用关键词与请求方法筛选。</p>
              </div>
            </div>
            <div>
              <span>02</span>
              <div>
                <strong>了解参数与鉴权</strong>
                <p>查看字段约束、身份凭据及接口的操作策略。</p>
              </div>
            </div>
            <div>
              <span>03</span>
              <div>
                <strong>复制示例，开始集成</strong>
                <p>使用原始示例或 cURL 模板，替换实际服务地址。</p>
              </div>
            </div>
          </div>
          <div className="start-example">
            <div className="example-caption">
              <span className="status-dot" />
              {exampleOperation ? '从第一个接口开始' : '接口示例'}
            </div>
            {exampleOperation ? (
              <>
                <CodeBlock
                  value={makeCurl(document, exampleOperation)}
                  label="cURL"
                  copyLabel="复制 cURL"
                />
                <a href={operationHash(exampleOperation)}>
                  查看 {exampleOperation.definition.summary || exampleOperation.path}
                  <ArrowRight size={14} />
                </a>
              </>
            ) : (
              <p>当前契约暂无接口定义。</p>
            )}
          </div>
        </div>
      </Section>
      <Section
        id="groups"
        title="接口分组"
        subtitle="按业务领域探索全部能力"
        badge={<span className="count-badge">{tags.length}</span>}
      >
        <div className="group-cards">
          {tags.map((tag, index) => {
            const Icon = icons[index % icons.length];
            const count = operations.filter((operation) => operation.tags.includes(tag)).length;
            const definition = (document.tags || []).find((item: ApiObject) => item.name === tag);
            return (
              <div
                className="group-card"
                key={tag}
              >
                <span className={`group-card-icon tone-${index % 4}`}>
                  <Icon size={21} />
                </span>
                <div className="group-card-copy">
                  <button className="group-card-title" onClick={() => onOpenTag(tag)} disabled={!count}>
                    {tag}
                  </button>
                  <Markdown>{definition?.description || '查看该分组的接口定义'}</Markdown>
                  <small>{count} 个接口</small>
                </div>
                <ArrowRight size={16} />
              </div>
            );
          })}
        </div>
      </Section>
      <Section id="conventions" title="通用约定">
        <div className="convention-grid">
          <div>
            <Globe2 size={20} />
            <h3>服务地址</h3>
            {(document.servers || []).length ? (
              document.servers.map((server: ApiObject, index: number) => (
                <div key={index}>
                  <code>{server.url}</code>
                  <Markdown>{server.description}</Markdown>
                  {server.variables && <RawDetails title="服务地址变量" value={server.variables} />}
                </div>
              ))
            ) : (
              <p>契约未指定服务地址，请使用实际部署地址。</p>
            )}
          </div>
          <div>
            <ShieldCheck size={20} />
            <h3>身份与权限</h3>
            <p>
              每个接口单独展示鉴权方式、权限范围、限流与审计要求。公开接口会标记为「无需鉴权」。
            </p>
          </div>
        </div>
        {document['x-contract-status'] && (
          <div className="info-callout">
            <CircleHelp size={17} />
            <div>
              <strong>契约与实际可用范围</strong>
              <p>当前契约状态如下，接口实际可用范围请结合后端实现和部署确认。</p>
              <RawDetails
                title="契约状态 · x-contract-status"
                value={document['x-contract-status']}
              />
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
function Authentication({ operation }: { operation: Operation }) {
  const requirements = operation.definition.security ?? document.security ?? [];
  if (!requirements.length)
    return (
      <div className="auth-public">
        <ShieldCheck size={18} />
        <strong>无需鉴权</strong>
        <span>该接口未要求身份凭据</span>
      </div>
    );
  return (
    <div className="authentication">
      <p className="helper-text">以下方案满足任意一组即可；同组内的凭据需要同时提供。</p>
      {requirements.map((requirement: ApiObject, index: number) => (
        <div className="auth-option" key={index}>
          <span className="auth-option-label">方案 {index + 1}</span>
          {Object.keys(requirement).length === 0 ? (
            <span>允许匿名访问</span>
          ) : (
            Object.entries(requirement).map(([name, scopes]) => {
              const scheme = resolveObject(document, document.components?.securitySchemes?.[name]);
              return (
                <div className="auth-scheme" key={name}>
                  <div>
                    <KeyRound size={15} />
                    <strong>{name}</strong>
                    <code>
                      {scheme.type || '未定义'}
                      {scheme.scheme ? ` / ${scheme.scheme}` : ''}
                    </code>
                  </div>
                  <Markdown>{scheme.description}</Markdown>
                  {scheme.name && (
                    <p>
                      传入位置：<code>{scheme.in}</code> · 参数名：<code>{scheme.name}</code>
                    </p>
                  )}
                  {scheme.bearerFormat && (
                    <p>
                      凭据格式：<code>{scheme.bearerFormat}</code>
                    </p>
                  )}
                  {(scopes as string[]).length > 0 && (
                    <p>
                      所需范围：<code>{(scopes as string[]).join(', ')}</code>
                    </p>
                  )}
                  {scheme.flows && <RawDetails title="OAuth 流程 · flows" value={scheme.flows} />}
                  {scheme.openIdConnectUrl && (
                    <p>
                      发现地址：<code>{scheme.openIdConnectUrl}</code>
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}

function Responses({ operation }: { operation: Operation }) {
  const responses = object(operation.definition.responses);
  const codes = Object.keys(responses);
  const [status, setStatus] = useState(codes[0]);
  const response = resolveObject(document, responses[status]);
  const headers = Object.entries(object(response.headers)).map(([name, raw]) => ({
    ...resolveObject(document, raw),
    name,
    in: 'header',
  }));
  if (!codes.length) return <div className="empty-note">契约未定义响应</div>;
  return (
    <div className="response-panel">
      <div className="status-tabs" role="tablist" aria-label="响应状态码">
        {codes.map((code) => (
          <button
            key={code}
            role="tab"
            aria-selected={status === code}
            className={status === code ? 'active' : ''}
            onClick={() => setStatus(code)}
          >
            <span
              className={`response-dot ${/^[23]/.test(code) ? 'success' : /^[45]/.test(code) ? 'error' : ''}`}
            />
            {code}
          </button>
        ))}
      </div>
      <div key={status} role="tabpanel" aria-label={`${status} 响应`}>
        <div className="response-description">
          <span className={`response-code ${/^[23]/.test(status) ? 'success' : ''}`}>{status}</span>
          <Markdown>{response.description}</Markdown>
        </div>
        {headers.length > 0 && (
          <details className="response-headers">
            <summary>
              响应头 <span>{headers.length}</span>
            </summary>
            <ParameterTable document={document} parameters={headers} />
          </details>
        )}
        {response.content && Object.keys(response.content).length ? (
          <MediaPanel key={status} document={document} content={response.content} />
        ) : (
          <div className="empty-note">该响应未定义响应体</div>
        )}
        {response.links && <RawDetails title="关联接口 · links" value={response.links} />}
      </div>
    </div>
  );
}

const POLICY_LABELS: Record<string, string> = {
  'x-permissions': '访问权限',
  'x-rate-limit': '请求限流',
  'x-idempotency': '幂等策略',
  'x-audit': '审计要求',
  'x-sensitive-fields': '敏感字段',
  'x-design-status': '设计状态',
};
const POLICY_FIELDS: Record<string, string> = {
  permission: '权限标识',
  roles: '允许角色',
  scope: '作用范围',
  window_seconds: '窗口秒数',
  principal_limit: '主体请求上限',
  ip_limit: 'IP 请求上限',
  key: '限流键',
  failure_policy: '失败策略',
  shared_across_sessions: '跨会话共享',
  required: '是否必需',
  retention: '保留策略',
  conflict: '冲突处理',
  recovery: '恢复方式',
  reason_required: '是否需要原因',
  events: '审计事件',
  secrets: '凭据处理',
  request_or_response: '涉及字段',
  logging: '日志规则',
};
function policyValue(value: any): string {
  return value === true
    ? '是'
    : value === false
      ? '否'
      : value === null
        ? '空值'
        : Array.isArray(value) && value.length === 0
          ? '无'
          : typeof value === 'object'
            ? JSON.stringify(value, null, 2)
            : String(value);
}
function Policies({ definition }: { definition: ApiObject }) {
  const extensions = Object.entries(definition).filter(([key]) => key.startsWith('x-'));
  if (!extensions.length) return <div className="empty-note">契约未定义扩展操作策略</div>;
  return (
    <div className="policy-grid">
      {extensions.map(([key, value]) => (
        <details className="policy-card" key={key} open={key !== 'x-design-status'}>
          <summary>
            <span>{POLICY_LABELS[key] || '扩展说明'}</span>
            <code>{key}</code>
            <ChevronDown size={14} />
          </summary>
          {value !== null && typeof value === 'object' && !Array.isArray(value) ? (
            <dl>
              {Object.entries(value).map(([field, item]) => (
                <div key={field}>
                  <dt>
                    {POLICY_FIELDS[field] || field}
                    <code>{field}</code>
                  </dt>
                  <dd>{policyValue(item)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>{policyValue(value)}</p>
          )}
        </details>
      ))}
    </div>
  );
}

function OperationDetail({ operation }: { operation: Operation }) {
  const definition = operation.definition;
  const body = resolveObject(document, definition.requestBody);
  const link = new URL(operationHash(operation), window.location.href).href;
  const parametersByLocation = ['path', 'query', 'header', 'cookie']
    .map((location) => ({
      location,
      values: operation.parameters.filter((parameter) => parameter.in === location),
    }))
    .filter((group) => group.values.length);
  return (
    <>
      <section id="description" className="operation-header">
        <div className="eyebrow">
          {operation.tags[0]}
          <ChevronRight size={12} />
          <span>{definition.operationId || '接口详情'}</span>
        </div>
        <div className="title-row">
          <h1>{definition.summary || operation.path}</h1>
          <CopyButton value={link} label="复制链接" />
        </div>
        <div className="operation-badges">
          <span className="doc-badge">
            <FileText size={12} />
            接口文档
          </span>
          {definition.deprecated && <span className="deprecated-badge">已弃用</span>}
          {operation.tags.map((tag) => (
            <span key={tag} className="tag-badge">
              {tag}
            </span>
          ))}
        </div>
        <div className="endpoint-bar">
          <span className={`method method-${operation.method}`}>
            {operation.method.toUpperCase()}
          </span>
          <code>{operation.path}</code>
          <CopyButton value={operation.path} label="复制路径" iconOnly />
        </div>
        <Markdown>{definition.description}</Markdown>
        {definition.externalDocs && (
          <a
            className="external-doc-link"
            href={definition.externalDocs.url}
            target="_blank"
            rel="noreferrer"
          >
            {definition.externalDocs.description || '相关文档'}
            <ExternalLink size={13} />
          </a>
        )}
        {operation.servers.length > 0 && (
          <div className="server-line">
            <Globe2 size={13} />
            <span>服务地址</span>
            {operation.servers.map((server, index) => (
              <code key={index}>{server.url}</code>
            ))}
          </div>
        )}
      </section>
      <Section id="authentication" title="身份认证">
        <Authentication operation={operation} />
      </Section>
      <Section
        id="parameters"
        title="请求参数"
        badge={<span className="count-badge">{operation.parameters.length}</span>}
      >
        {parametersByLocation.length ? (
          parametersByLocation.map((group) => (
            <div key={group.location} className="parameter-group">
              <h3>
                <span>{group.location[0].toUpperCase() + group.location.slice(1)}</span> 参数{' '}
                <span className="muted">{group.values.length}</span>
              </h3>
              <ParameterTable document={document} parameters={group.values} />
            </div>
          ))
        ) : (
          <div className="empty-note">该接口未定义 Path / Query / Header / Cookie 参数</div>
        )}
      </Section>
      <Section
        id="request"
        title="请求体与示例"
        badge={body.required ? <span className="required">必填</span> : undefined}
      >
        {definition.requestBody ? (
          <>
            <Markdown>{body.description}</Markdown>
            <MediaPanel document={document} content={body.content || {}} operation={operation} />
          </>
        ) : (
          <>
            <p className="helper-text">该接口未定义请求体。以下为根据接口定义生成的请求模板。</p>
            <CodeBlock
              value={makeCurl(document, operation)}
              label="cURL · 请求模板"
              copyLabel="复制 cURL"
            />
            <p className="helper-text">请按实际部署替换相对服务地址及花括号中的参数与凭据。</p>
          </>
        )}
      </Section>
      <Section id="responses" title="返回响应" subtitle="状态码、响应模型与原始示例">
        <Responses operation={operation} />
      </Section>
      <Section id="policies" title="操作策略" subtitle="保留扩展字段原名，便于对照契约">
        <Policies definition={definition} />
      </Section>
      <div className="end-note">
        <Check size={15} />
        已展示该接口的全部主要定义<span>OpenAPI {document.openapi}</span>
      </div>
    </>
  );
}
