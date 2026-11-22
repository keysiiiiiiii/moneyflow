import MoneyFlowApp from './MoneyFlowApp'
import { AppGate } from './components/AppGate'
import { AuthProvider } from './lib/supabase/AuthProvider'

export default function App() {
	return <AuthProvider><AppGate><MoneyFlowApp /></AppGate></AuthProvider>
}
