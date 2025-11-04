import { useState } from 'react'
import { Chatbot } from './components/Chatbot'

export default function App() {
  const [visible, setVisible] = useState(true)
  return (
    <>
      <Chatbot visible={visible} onClose={() => setVisible(false)} />
      {!visible && (
        <button className="chatbot-fab" onClick={() => setVisible(true)} aria-label="Open chatbot">💬</button>
      )}
    </>
  )
}


