import { useState, useRef, useCallback } from 'react'
import JSZip from 'jszip'
import './App.css'

function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i]
}

const LEVELS = [
  { label: 'Rápida',      value: 1, hint: 'Mais rápida, menos eficiente', factor: 0.82 },
  { label: 'Balanceada',  value: 6, hint: 'Equilíbrio velocidade/tamanho', factor: 0.68 },
  { label: 'Máxima',      value: 9, hint: 'Menor tamanho possível',        factor: 0.58 },
]

export default function App() {
  const [files,    setFiles]    = useState([])
  const [level,    setLevel]    = useState(9)
  const [dragging, setDragging] = useState(false)
  const [status,   setStatus]   = useState('idle')   // idle | compressing | done | error
  const [progress, setProgress] = useState(0)
  const [result,   setResult]   = useState(null)

  const fileRef   = useRef()
  const folderRef = useRef()

  // ── helpers ──────────────────────────────────────────────────────────────
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
          reader.readEntries(async entries => {
            await Promise.all(entries.map(traverse))
            res()
          })
        } else res()
      })
      Promise.all(
        Array.from(items).map(i => i.webkitGetAsEntry()).filter(Boolean).map(traverse)
      ).then(() => addFiles(fileList))
    } else {
      addFiles(e.dataTransfer.files)
    }
  }, [addFiles])

  const totalSize = files.reduce((s, f) => s + f.size, 0)

  // ── compress ─────────────────────────────────────────────────────────────
  const compress = async () => {
    if (!files.length) return
    setStatus('compressing')
    setProgress(0)
    try {
      const zip = new JSZip()
      files.forEach(f => {
        const path = f._path || f.webkitRelativePath || f.name
        zip.file(path, f)
      })
      const blob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level } },
        meta => setProgress(Math.round(meta.percent))
      )
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
    a.href     = url
    a.download = 'compressed.zip'
    a.click()
    URL.revokeObjectURL(url)
  }

  const reset = () => {
    setFiles([]); setResult(null); setStatus('idle'); setProgress(0)
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div>
          <h1>Compressor de Arquivos</h1>
          <p className="subtitle">Arraste arquivos ou pastas — exporta .zip com DEFLATE</p>
        </div>
        {files.length > 0 && (
          <button onClick={reset} className="btn-ghost">↺ Limpar</button>
        )}
      </header>

      {/* Drop zone */}
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current.click()}
      >
        <span className="drop-icon">⬆</span>
        <p className="drop-title">Arraste arquivos ou clique para selecionar</p>
        <p className="drop-hint">Suporta múltiplos arquivos e pastas inteiras</p>
        <div className="drop-btns" onClick={e => e.stopPropagation()}>
          <button onClick={() => fileRef.current.click()}>📄 Arquivos</button>
          <button onClick={() => folderRef.current.click()}>📁 Pasta</button>
        </div>
      </div>

      <input ref={fileRef}   type="file" multiple              style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
      <input ref={folderRef} type="file" webkitdirectory="" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />

      {/* File list */}
      {files.length > 0 && (
        <div className="file-list">
          <div className="file-list-header">
            <span>{files.length} arquivo{files.length > 1 ? 's' : ''}</span>
            <span>Total: {formatBytes(totalSize)}</span>
          </div>
          <div className="file-rows">
            {files.map((f, i) => {
              const path = f._path || f.webkitRelativePath || f.name
              return (
                <div key={i} className="file-row">
                  <span className="file-icon">📄</span>
                  <span className="file-name" title={path}>{path}</span>
                  <span className="file-size">{formatBytes(f.size)}</span>
                  <button
                    className="remove-btn"
                    aria-label="Remover"
                    onClick={() => {
                      setFiles(prev => prev.filter((_, j) => j !== i))
                      setResult(null); setStatus('idle')
                    }}
                  >✕</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Level selector */}
      {files.length > 0 && status !== 'done' && (
        <div className="level-section">
          <p className="section-label">Nível de compressão</p>
          <div className="level-grid">
            {LEVELS.map(l => (
              <div
                key={l.value}
                className={`level-card${level === l.value ? ' active' : ''}`}
                onClick={() => setLevel(l.value)}
              >
                <p className="level-name">{l.label}</p>
                <p className="level-hint">{l.hint}</p>
                {totalSize > 0 && (
                  <p className="level-est">≈ {formatBytes(totalSize * l.factor)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compress button + progress */}
      {files.length > 0 && status !== 'done' && (
        <div className="compress-section">
          <button
            className="primary"
            onClick={compress}
            disabled={status === 'compressing'}
          >
            {status === 'compressing' ? `Comprimindo… ${progress}%` : 'Comprimir agora'}
          </button>
          {status === 'compressing' && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {status === 'done' && result && (
        <div className="result-card">
          <p className="result-title">✓ Compressão concluída</p>
          <div className="stats-grid">
            <div className="stat">
              <span className="stat-label">Original</span>
              <span className="stat-value">{formatBytes(totalSize)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Comprimido</span>
              <span className="stat-value highlight">{formatBytes(result.size)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Economia</span>
              <span className={`stat-value ${result.ratio > 0 ? 'green' : ''}`}>
                {result.ratio.toFixed(1)}%
              </span>
            </div>
          </div>

          {result.ratio > 0 && (
            <div className="ratio-bar-wrap">
              <div className="ratio-bar">
                <div className="ratio-fill" style={{ width: `${100 - result.ratio}%` }} />
              </div>
              <div className="ratio-labels">
                <span>Arquivo final ({(100 - result.ratio).toFixed(1)}%)</span>
                <span>Liberado ({result.ratio.toFixed(1)}%)</span>
              </div>
            </div>
          )}

          {result.savings < 0 && (
            <p className="warning-note">
              ⚠ Arquivos já comprimidos (JPEG, MP4, PDF) raramente reduzem com ZIP.
            </p>
          )}

          <div className="result-actions">
            <button className="primary" onClick={download}>⬇ Baixar compressed.zip</button>
            <button onClick={reset}>↺</button>
          </div>
        </div>
      )}

      {status === 'error' && (
        <p className="error-msg">✕ Erro ao comprimir. Tente novamente.</p>
      )}
    </div>
  )
}
