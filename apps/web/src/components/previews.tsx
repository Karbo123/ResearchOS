import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { Artifact, ArtifactPreview } from '../types'

function PointCloudPreview({ preview }: { preview: Extract<ArtifactPreview, { type: 'point_cloud' }> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const points = preview.points || []
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const state = { yaw: 0.55, pitch: 0.25, zoom: 1, dragging: false, x: 0, y: 0 }

    const draw = () => {
      const width = canvas.width
      const height = canvas.height
      context.clearRect(0, 0, width, height)
      context.fillStyle = '#17201d'
      context.fillRect(0, 0, width, height)
      if (!points.length) {
        context.fillStyle = '#aab6b1'
        context.font = '14px sans-serif'
        context.textAlign = 'center'
        context.fillText('没有可显示的有效点', width / 2, height / 2)
        return
      }
      const mins = [Infinity, Infinity, Infinity]
      const maxs = [-Infinity, -Infinity, -Infinity]
      points.forEach(point => point.forEach((value, index) => {
        if (index < 3) {
          mins[index] = Math.min(mins[index], value)
          maxs[index] = Math.max(maxs[index], value)
        }
      }))
      const center = mins.map((min, index) => (min + maxs[index]) / 2)
      const scale = Math.max(...maxs.map((max, index) => max - mins[index]), 1)
      const projected = points
        .map((point, index) => {
          const p = point.map((value, axis) => (value - center[axis]) / scale)
          const cy = Math.cos(state.yaw)
          const sy = Math.sin(state.yaw)
          const cp = Math.cos(state.pitch)
          const sp = Math.sin(state.pitch)
          const x = p[0]! * cy - p[2]! * sy
          const depth = p[0]! * sy + p[2]! * cy
          const y = p[1]! * cp - depth * sp
          const z = p[1]! * sp + depth * cp
          return { x: width / 2 + x * width * 0.82 * state.zoom, y: height / 2 - y * height * 0.82 * state.zoom, z, index }
        })
        .sort((a, b) => a.z - b.z)

      if (preview.faces?.length && points.length < 2000) {
        context.strokeStyle = '#56b89555'
        context.lineWidth = 1
        preview.faces.forEach(face => {
          const vertices = face.map(index => projected.find(point => point.index === index)).filter(Boolean)
          if (vertices.length >= 3) {
            context.beginPath()
            context.moveTo(vertices[0]!.x, vertices[0]!.y)
            vertices.slice(1).forEach(point => context.lineTo(point!.x, point!.y))
            context.closePath()
            context.stroke()
          }
        })
      }
      projected.forEach(point => {
        const alpha = Math.max(0.25, Math.min(1, 0.58 + point.z))
        context.fillStyle = `rgba(86,184,149,${alpha})`
        context.fillRect(point.x - 1.5, point.y - 1.5, 3, 3)
      })
    }

    const onPointerDown = (event: PointerEvent) => {
      state.dragging = true
      state.x = event.clientX
      state.y = event.clientY
      canvas.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!state.dragging) return
      state.yaw += (event.clientX - state.x) * 0.01
      state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch + (event.clientY - state.y) * 0.01))
      state.x = event.clientX
      state.y = event.clientY
      draw()
    }
    const onPointerUp = () => {
      state.dragging = false
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      state.zoom = Math.max(0.35, Math.min(4, state.zoom * (event.deltaY > 0 ? 0.9 : 1.1)))
      draw()
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    draw()
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [points, preview.faces, resetKey])

  const reset = () => {
    setResetKey(key => key + 1)
  }

  return (
    <div className="artifact-preview">
      <div className="point-cloud-tools">
        <span className="muted">
          {String(preview.format || 'ply').toUpperCase()} · {points.length}/{Number(preview.source_point_count || points.length)} 点
          {preview.sampled ? ' · 已降采样' : ''}
        </span>
        <button className="icon-btn point-reset" type="button" title="重置视图" aria-label="重置视图" onClick={reset}>
          <RotateCcw size={15} />
        </button>
      </div>
      <canvas ref={canvasRef} className="point-cloud-canvas" width="640" height="420" aria-label="点云预览" />
      {preview.faces?.length ? <div className="preview-footnote">已加载 {preview.faces.length} 个面片，使用线框显示。</div> : null}
    </div>
  )
}

function TimeseriesPreview({ preview }: { preview: Extract<ArtifactPreview, { type: 'timeseries' }> }) {
  const points = (preview.points || []).filter(point => point && Number.isFinite(Number(point.step)))
  const metrics = ['loss', 'accuracy', 'validation_loss', 'validation_accuracy', 'learning_rate'].filter(metric =>
    points.some(point => Number.isFinite(Number(point[metric]))),
  )
  const [metric, setMetric] = useState(metrics[0] || 'loss')
  const [windowSize, setWindowSize] = useState(Math.max(10, points.length))
  const allSeeds = [...new Set(points.map(point => String(point.seed ?? 'all')))]
  const [selectedSeeds, setSelectedSeeds] = useState<string[]>(allSeeds)
  const [hovered, setHovered] = useState<{ step: number; value: number; seed: string } | null>(null)
  const seedKey = allSeeds.join('|')

  useEffect(() => {
    setSelectedSeeds(current => {
      const next = current.filter(seed => allSeeds.includes(seed))
      return next.length ? next : allSeeds
    })
  }, [seedKey])

  if (!points.length || !metrics.length) {
    return <div className="preview-error">没有可绘制的有限数值指标。</div>
  }

  const visible = points.slice(-windowSize)
  const numeric = visible.filter(point => selectedSeeds.includes(String(point.seed ?? 'all')) && Number.isFinite(Number(point[metric])))
  const missingCount = visible.filter(point => selectedSeeds.includes(String(point.seed ?? 'all')) && !Number.isFinite(Number(point[metric]))).length
  if (!numeric.length) {
    return <div className="preview-error">当前选择没有可绘制的有限数值指标；缺失值不会被补写或插值。</div>
  }
  const steps = numeric.map(point => Number(point.step))
  const minStep = Math.min(...steps)
  const stepSpan = Math.max(Math.max(...steps) - minStep, 1)
  const values = numeric.map(point => Number(point[metric]))
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const span = Math.max(maxValue - minValue, 1e-12)
  const groups = [...new Set(numeric.map(point => String(point.seed ?? 'all')))]
  const colors = ['#16856b', '#d97706', '#2563eb', '#be123c', '#7c3aed', '#0f766e']

  return (
    <div className="artifact-preview">
      <div className="timeseries-toolbar">
        <label>
          指标
          <select value={metric} onChange={event => setMetric(event.target.value)}>
            {metrics.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          点数
          <input
            type="range"
            min={10}
            max={Math.max(10, points.length)}
            value={windowSize}
            onChange={event => setWindowSize(Number(event.target.value))}
          />
        </label>
        <div className="timeseries-seeds" aria-label="选择随机种子">
          <span className="muted">seed</span>
          {allSeeds.map(seed => (
            <button
              key={seed}
              className={selectedSeeds.includes(seed) ? 'seed-toggle active' : 'seed-toggle'}
              type="button"
              onClick={() => setSelectedSeeds(current => current.includes(seed)
                ? current.length === 1 ? current : current.filter(value => value !== seed)
                : [...current, seed])}
            >
              {seed}
            </button>
          ))}
        </div>
        <span className="muted timeseries-count">{numeric.length}/{points.length} 个点</span>
      </div>
      <div className="timeseries-chart-wrap">
      <svg
        className="timeseries-chart"
        viewBox="0 0 720 300"
        role="img"
        aria-label={`${metric} 指标曲线`}
        onMouseLeave={() => setHovered(null)}
        onMouseMove={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          const x = Math.max(48, Math.min(704, ((event.clientX - rect.left) / rect.width) * 720))
          const targetStep = minStep + ((x - 48) / 656) * stepSpan
          const nearest = numeric.reduce((best, point) => Math.abs(Number(point.step) - targetStep) < Math.abs(Number(best.step) - targetStep) ? point : best, numeric[0]!)
          setHovered({ step: Number(nearest.step), value: Number(nearest[metric]), seed: String(nearest.seed ?? 'all') })
        }}
      >
        <rect x="0" y="0" width="720" height="300" fill="#f7faf8" rx="8" />
        <line x1="48" y1="18" x2="48" y2="266" stroke="#cbd5d1" />
        <line x1="48" y1="266" x2="704" y2="266" stroke="#cbd5d1" />
        <text x="52" y="18" fill="#60706a" fontSize="11">
          {metric} · {minValue.toPrecision(4)}–{maxValue.toPrecision(4)}
        </text>
        {groups.map((seed, groupIndex) => {
          const group = numeric
            .filter(point => String(point.seed ?? 'all') === seed)
            .sort((a, b) => Number(a.step) - Number(b.step))
          const segments: typeof group[] = []
          visible
            .filter(point => String(point.seed ?? 'all') === seed)
            .sort((a, b) => Number(a.step) - Number(b.step))
            .forEach(point => {
              if (!Number.isFinite(Number(point[metric]))) return
              const segment = segments.at(-1)
              if (segment) segment.push(point)
              else segments.push([point])
            })
          const color = colors[groupIndex % colors.length]
          return (
            <g key={seed}>
              {segments.map((segment, segmentIndex) => (
                <polyline
                  key={segmentIndex}
                  points={segment.map(point => `${48 + ((Number(point.step) - minStep) / stepSpan) * 656},${250 - ((Number(point[metric]) - minValue) / span) * 220}`).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              ))}
              <text x={56 + groupIndex * 86} y={288} fill={color} fontSize="11">seed {seed}</text>
              {group.map((point, index) => {
                const x = 48 + ((Number(point.step) - minStep) / stepSpan) * 656
                const y = 250 - ((Number(point[metric]) - minValue) / span) * 220
                const isHovered = hovered?.step === Number(point.step) && hovered.seed === seed
                return <circle key={index} cx={x} cy={y} r={isHovered ? 6 : 3} fill={color} stroke={isHovered ? '#17201d' : 'none'} strokeWidth="2" />
              })}
            </g>
          )
        })}
      </svg>
      {hovered ? <div className="timeseries-tooltip">step {hovered.step} · seed {hovered.seed} · {metric} {hovered.value.toPrecision(6)}</div> : null}
      </div>
      {missingCount ? <div className="preview-footnote">{missingCount} 个点缺少 {metric}，已按缺失值保留并跳过绘制。</div> : null}
    </div>
  )
}

function PreviewBody({ preview }: { preview: ArtifactPreview }) {
  switch (preview.type) {
    case 'point_cloud':
      return <PointCloudPreview preview={preview} />
    case 'timeseries':
      return <TimeseriesPreview preview={preview} />
    case 'video':
      return <video className="artifact-video" controls preload="metadata" src={preview.download_url} />
    case 'image':
      return <div className="preview-footnote">图片直接使用下载接口展示。</div>
    case 'json': {
      const value = typeof preview.value === 'string' ? preview.value : JSON.stringify(preview.value, null, 2)
      return <pre className="preview-text">{value}</pre>
    }
    case 'pdf': {
      const label = `PDF · ${Number(preview.page_count || 0)} 页，仅展示前 3 页可提取文本`
      return <pre className="preview-text">{preview.text || ''}</pre>
    }
    case 'table':
      return (
        <div className="table-preview">
          <table>
            <tbody>
              {preview.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => <td key={cellIndex}>{String(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'html_text':
    case 'text':
      return <pre className="preview-text">{preview.text || ''}</pre>
    default:
      return null
  }
}

export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const [preview, setPreview] = useState<ArtifactPreview | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    if (artifact.mime_type?.startsWith('image/')) return
    if (!artifact.preview_url) return
    setStatus('loading')
    api<ArtifactPreview>(artifact.preview_url)
      .then(data => {
        setPreview(data)
        setStatus('ready')
      })
      .catch(err => {
        setError(errorMessage(err))
        setStatus('error')
      })
  }, [artifact.preview_url, artifact.mime_type])

  return (
    <article className="artifact-card">
      {!artifact.valid ? (
        <div className="artifact-preview preview-error">该产物已失效，不能预览或下载。</div>
      ) : artifact.experiment_status && artifact.experiment_status !== 'succeeded' ? (
        <div className="artifact-preview preview-error">关联运行状态为 {artifact.experiment_status}，不显示为成功产物。</div>
      ) : artifact.mime_type?.startsWith('image/') ? (
        <img className="artifact-image" src={artifact.download_url || artifact.url} alt={artifact.name} />
      ) : status === 'loading' ? (
        <div className="artifact-preview"><div className="preview-loading">加载预览…</div></div>
      ) : status === 'error' ? (
        <div className="artifact-preview"><div className="preview-error">预览失败：{error}</div></div>
      ) : status === 'ready' && preview ? (
        <PreviewBody preview={preview} />
      ) : null}
      <div className="artifact-body">
        <h3>{artifact.name}</h3>
        <p className="muted">{artifact.kind} · {artifact.valid ? '有效' : '已失效'}{artifact.experiment_status ? ` · 运行 ${artifact.experiment_status}` : ''}</p>
        <p className="artifact-lineage">{artifact.metadata?.lineage && typeof artifact.metadata.lineage === 'object'
          ? `Run ${String((artifact.metadata.lineage as Record<string, unknown>).run_id || '未绑定')} · Idea v${String((artifact.metadata.lineage as Record<string, unknown>).idea_version || '未知')} · 数据 ${String((artifact.metadata.lineage as Record<string, unknown>).data_version || '未声明')}`
          : '谱系信息未声明'}</p>
        {artifact.valid && artifact.experiment_status !== 'failed' && artifact.experiment_status !== 'cancelled' ? <a href={artifact.download_url || artifact.url} download>下载产物</a> : null}
      </div>
    </article>
  )
}
