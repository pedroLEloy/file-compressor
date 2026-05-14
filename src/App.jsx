import { useState, useRef, useCallback, useMemo } from 'react'
import { zip } from 'fflate'
import './App.css'

function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i]
}

const BINARY_EXTS = new Set([
  'jpg','jpeg','png','gif','webp','avif','heic','bmp','ico',
  'mp4','mov','avi','mkv','wmv','flv','m4v','webm',
  'mp3','aac','ogg','flac','wav','m4a','wma',
  'zip','gz','bz2','xz','7z','rar','tar','br','zst',
  'pdf','docx','xlsx','pptx','odt','ods','odp',
  'exe','dll','so','dylib','bin','dat','iso','img',
  'ttf','otf','woff','woff2',
  'psd','ai','sketch','fig',
  'sqlite','db',
])

const TEXT_EXTS = new Set([
  'txt','log','csv','tsv','json','xml','html','htm','css','js','ts',
  'jsx','tsx','md','mdx','sql','yaml','yml','ini','cfg','conf','env',
  'sh','bash','py','rb','go','rs','java','c','cpp','h','cs','php',
  'vue','svelte','graphql','proto','toml','lock',
])

function classify(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (BINARY_EXTS.has(ext)) return 'binary'
  if (TEXT_EXTS.has(ext))   return 'text'
  return 'unknown'
}

const COMPRESS_FACTOR = { text: 0.15, unknown: 0.55, binary: 0.97 }

function analyseFiles(files) {
  const groups = { text: 0, binary: 0, unknown: 0 }
  for (const f of files) groups[classify(f)] += f.size
  const total = groups.text + groups.binary + groups.unknown
  const estimated = Object.entries(groups).reduce(
    (sum, [cat, sz]) => sum + sz * COMPRESS_FACTOR[cat], 0
  )
  return { groups, total, estimated, ratio: total ? (1 - estimated / total) * 100 : 0 }
}

const LEVELS = [
  { label: 'Rápida',     value: 1, hint: 'Mais rápida, menos eficiente' },
  { label: 'Balanceada', value: 6, hint: 'Equilíbrio velocidade/tamanho' },
  { label: 'Máxima',     value: 9, hint: 'Menor tamanho possível'        },
]

export default function App() {
  const [files,    setFiles]    = useState([])
  const [level,    setLevel]    = useState(9)
  const [dragging, setDragging] = useState(false)
  const [status,   setStatus]   = useState('idle')
  const [progress, setProgress] = useState(0)
  const [result,   setResult]   = useState(null)

  const fileRef   = useRef()
  const folderRef = useRef()

  const addFiles = useCallback((incoming) => {
    const arr = Array.from(incoming).filter(f => f.size > 0)
    if (!arr.length) return
    setFiles(prev => {
      const existing = new Set(prev.map(f => f._path || f.webkitRelativePath || f.name))
      return [...prev, ...arr.filter(f => !existing.has(f._path || f.webkitRelativePath || f.name))]
    })
    setResult(null)
    setStatus('idle')
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const items = e.dataTransfer.items
    if (items) {
      const fileList = []
      const traverse = (entry) => new Promise(res => {
        if (entry.isFile) {
          entry.file(f => { f._path = entry.fullPath.slice(1); fileList.push(f); res() })
        } else if (entry.isDirectory) {
          const reader = entry.createReader()
          const readAll = () => reader.readEntries(async entries => {
            if (!entries.length) return res()
            await Promise.all(entries.map(traverse))
            readAll()
          })
          readAll()
        } else res()
      })
      Promise.all(
        Array.from(items).map(i => i.webkitGetAsEntry()).filter(Boolean).map(traverse)
      ).then(() => addFiles(fileList))
    } else {
      addFiles(e.dataTransfer.files)
    }
  }, [addFiles])

  const analysis = useMemo(() => analyseFiles(files), [files])
  const totalSize = analysis.total

  const compress = async () => {
    if (!files.length) return
    setStatus('compressing')
    setProgress(0)

    try {
      const fileMap = {}
      let bytesRead = 0

      for (const f of files) {
        const path = f._path || f.webkitRelativePath || f.name
        const buf  = await f.arrayBuffer()
        fileMap[path] = [new Uint8Array(buf), { level }]
        bytesRead += f.size
        setProgress(Math.round((bytesRead / totalSize) * 50))
      }

      const blob = await new Promise((resolve, reject) => {
        zip(fileMap, { comment: 'compressed by file-compressor' }, (err, data) => {
          if (err) return reject(err)
          resolve(new Blob([data], { type: 'application/zip' }))
        })
      })

      setProgress(100)
      const savings = totalSize - blob.size
      setResult({ blob, size: blob.size, savings, ratio: Math.max(0, (savings / totalSize) * 100) })
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }

  const download = () => {
    const url = URL.createObjectURL(result.blob)
    const a   = document.createElement('a')
    a.href = url; a.download = 'compressed.zip'; a.click()
    URL.revokeObjectURL(url)
  }

  const reset = () => { setFiles([]); setResult(null); setStatus('idle'); setProgress(0) }

  const AnalysisPanel = () => {
    const { groups, estimated, ratio } = analysis
    if (!totalSize) return null
    const pct = (sz) => totalSize ? ((sz / totalSize) * 100).toFixed(0) + '%' : '0%'
    const exp = groups.binary / totalSize > 0.7
      ? { type: 'warn', msg: 'A maioria dos arquivos já é comprimida (mídia/PDF/ZIP). O ganho será pequeno.' }
      : groups.text / totalSize > 0.6
        ? { type: 'good', msg: 'Ótimo! Arquivos de texto comprimem muito bem.' }
        : { type: 'info', msg: 'Mix de arquivos. Ganho depende da proporção de texto vs. mídia.' }

    return (
      <div className="analysis-panel">
        <p className="section-label">Análise dos arquivos</p>
        <div className="type-bars">
          {groups.text > 0 && (
            <div className="type-row">
              <span className="type-dot text" />
              <span className="type-label">Texto / código</span>
              <div className="type-bar-wrap"><div className="type-bar-fill text" style={{ width: pct(groups.text) }} /></div>
              <span className="type-size">{formatBytes(groups.text)} <span className="compress-tag">~85% redução</span></span>
            </div>
          )}
          {groups.unknown > 0 && (
            <div className="type-row">
              <span className="type-dot unknown" />
              <span className="type-label">Desconhecido</span>
              <div className="type-bar-wrap"><div className="type-bar-fill unknown" style={{ width: pct(groups.unknown) }} /></div>
              <span className="type-size">{formatBytes(groups.unknown)} <span className="compress-tag">~45% redução</span></span>
            </div>
          )}
          {groups.binary > 0 && (
            <div className="type-row">
              <span className="type-dot binary" />
              <span className="type-label">Mídia / comprimido</span>
              <div className="type-bar-wrap"><div className="type-bar-fill binary" style={{ width: pct(groups.binary) }} /></div>
              <span className="type-size">{formatBytes(groups.binary)} <span className="compress-tag warn">~3% redução</span></span>
            </div>
          )}
        </div>
        <div className="est-row">
          <span>{formatBytes(totalSize)}</span>
          <span className="est-arrow">→</span>
          <span className="est-result">≈ {formatBytes(estimated)}</span>
          <span className="est-badge">economia estimada: {ratio.toFixed(0)}%</span>
        </div>
        <p className={`exp-note ${exp.type}`}>{exp.msg}</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Compressor de Arquivos</h1>
          <p className="subtitle">Combine arquivos e pastas • análise inteligente de tipos</p>
        </div>
        {files.length > 0 && <button onClick={reset} className="btn-ghost">↺ Limpar</button>}
      </header>

      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current.click()}
      >
        <span className="drop-icon">⬆</span>
        <p className="drop-title">Arraste arquivos e/ou pastas aqui</p>
        <p className="drop-hint">Você pode misturar arquivos soltos com pastas inteiras</p>
        <div className="drop-btns" onClick={e => e.stopPropagation()}>
          <button onClick={() => fileRef.current.click()}>📄 Adicionar arquivos</button>
          <button onClick={() => folderRef.current.click()}>📁 Adicionar pasta</button>
        </div>
        {files.length > 0 && <p className="drop-add-hint">Clique novamente para adicionar mais</p>}
      </div>

      <input ref={fileRef}   type="file" multiple          style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
      <input ref={folderRef} type="file" webkitdirectory="" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />

      {files.length > 0 && (
        <div className="file-list">
          <div className="file-list-header">
            <span>{files.length} arquivo{files.length > 1 ? 's' : ''}</span>
            <span>Total: {formatBytes(totalSize)}</span>
          </div>
          <div className="file-rows">
            {files.map((f, i) => {
              const path = f._path || f.webkitRelativePath || f.name
              const cat  = classify(f)
              return (
                <div key={i} className="file-row">
                  <span className={`type-dot sm ${cat}`} />
                  <span className="file-name" title={path}>{path}</span>
                  <span className="file-size">{formatBytes(f.size)}</span>
                  <button className="remove-btn" aria-label="Remover"
                    onClick={() => { setFiles(prev => prev.filter((_, j) => j !== i)); setResult(null); setStatus('idle') }}>✕</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {files.length > 0 && status !== 'done' && (
        <div className="add-more-bar">
          <span>Adicionar mais:</span>
          <button onClick={() => fileRef.current.click()}>📄 Arquivos</button>
          <button onClick={() => folderRef.current.click()}>📁 Pasta</button>
        </div>
      )}

      {files.length > 0 && status !== 'done' && <AnalysisPanel />}

      {files.length > 0 && status !== 'done' && (
        <div className="level-section">
          <p className="section-label">Nível de compressão</p>
          <div className="level-grid">
            {LEVELS.map(l => (
              <div key={l.value} className={`level-card${level === l.value ? ' active' : ''}`} onClick={() => setLevel(l.value)}>
                <p className="level-name">{l.label}</p>
                <p className="level-hint">{l.hint}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && status !== 'done' && (
        <div className="compress-section">
          <button className="primary" onClick={compress} disabled={status === 'compressing'}>
            {status === 'compressing' ? `Comprimindo… ${progress}%` : 'Comprimir agora'}
          </button>
          {status === 'compressing' && (
            <>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              {progress <= 50 && <p className="progress-hint">Lendo arquivos… fase 1/2</p>}
              {progress > 50  && <p className="progress-hint">Comprimindo… fase 2/2</p>}
            </>
          )}
        </div>
      )}

      {status === 'done' && result && (
        <div className="result-card">
          <p className="result-title">✓ Compressão concluída</p>
          <div className="stats-grid">
            <div className="stat"><span className="stat-label">Original</span><span className="stat-value">{formatBytes(totalSize)}</span></div>
            <div className="stat"><span className="stat-label">Comprimido</span><span className="stat-value highlight">{formatBytes(result.size)}</span></div>
            <div className="stat"><span className="stat-label">Economia</span><span className={`stat-value ${result.ratio > 0 ? 'green' : ''}`}>{result.ratio.toFixed(1)}%</span></div>
          </div>
          {result.ratio > 0 && (
            <div className="ratio-bar-wrap">
              <div className="ratio-bar"><div className="ratio-fill" style={{ width: `${(100 - result.ratio).toFixed(1)}%` }} /></div>
              <div className="ratio-labels">
                <span>Arquivo final ({(100 - result.ratio).toFixed(1)}%)</span>
                <span>Liberado ({result.ratio.toFixed(1)}%)</span>
              </div>
            </div>
          )}
          {result.savings < 0 && <p className="warning-note">⚠ A maioria dos arquivos já era comprimida — ZIP praticamente não consegue reduzir mais.</p>}
          <div className="result-actions">
            <button className="primary" onClick={download}>⬇ Baixar compressed.zip</button>
            <button onClick={reset}>↺</button>
          </div>
        </div>
      )}

      {status === 'error' && <p className="error-msg">✕ Erro ao comprimir. Para arquivos muito grandes, tente em partes menores.</p>}
    </div>
  )
}
