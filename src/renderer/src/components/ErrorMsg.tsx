import { useState } from 'react'

export default function ErrorMsg({ text, className = 'admin-error', style }: {
  text: string
  className?: string
  style?: React.CSSProperties
}) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={className} style={style}>
      <span className="error-msg-text">{text}</span>
      <button className="error-copy-btn" onClick={copy} title="Copy error">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
