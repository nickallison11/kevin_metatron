'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';

const API = process.env.NEXT_PUBLIC_API_BASE_URL;

export default function InvestorMemosPage() {
  const { token, loading } = useAuth('INVESTOR');
  const [memos, setMemos] = useState<any[]>([]);
  const [investorTier, setInvestorTier] = useState<string>('free');
  const [selected, setSelected] = useState<any>(null);
  const [monthCount, setMonthCount] = useState(0);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/investor-profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setInvestorTier(d.investor_tier ?? 'free'));
    fetch(`${API}/investment-memos`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(data => {
        if (Array.isArray(data)) {
          setMemos(data);
          const thisMonth = new Date().toISOString().slice(0, 7);
          setMonthCount(data.filter((m: any) => m.generated_at?.startsWith(thisMonth)).length);
        }
      });
  }, [token]);

  if (loading) return null;
  if (!token) return null;

  if (investorTier === 'free') {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <h2 style={{ color: 'var(--text)', marginTop: 16 }}>Investment Memos</h2>
        <p style={{ color: 'var(--muted)', marginTop: 8 }}>
          Generate AI-powered investment memos for any founder.
        </p>
        <a href="/investor/settings/subscription" style={{
          display: 'inline-block', marginTop: 24, padding: '12px 24px',
          background: '#6c5ce7', color: '#fff', borderRadius: 12, textDecoration: 'none'
        }}>Upgrade to Investor Basic</a>
      </div>
    );
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ color: 'var(--text)', fontSize: 24, fontWeight: 600 }}>Investment Memos</h1>
        {investorTier === 'basic' && (
          <span style={{ color: 'var(--muted)', fontSize: 14 }}>{monthCount} / 5 memos this month</span>
        )}
      </div>

      {memos.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No memos yet. Generate one from a founder's profile in Deal Flow.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {memos.map(m => (
            <div key={m.id} onClick={() => setSelected(m)} style={{
              background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 12, padding: '16px 20px', cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <div>
                <div style={{ color: 'var(--text)', fontWeight: 600 }}>{m.company_name ?? 'Unknown'}</div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                  {new Date(m.generated_at).toLocaleDateString()}
                </div>
              </div>
              <span style={{ color: '#6c5ce7', fontSize: 13 }}>View →</span>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16, padding: 32, maxWidth: 720, width: '100%',
            maxHeight: '80vh', overflowY: 'auto', position: 'relative'
          }}>
            <button onClick={() => setSelected(null)} style={{
              position: 'absolute', top: 16, right: 16, background: 'none',
              border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer'
            }}>✕</button>
            <h2 style={{ color: 'var(--text)', marginBottom: 16 }}>{selected.company_name ?? 'Investment Memo'}</h2>
            <pre style={{ color: 'var(--text)', whiteSpace: 'pre-wrap', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.7 }}>
              {selected.content}
            </pre>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button onClick={() => navigator.clipboard.writeText(selected.content)} style={{
                padding: '10px 20px', background: '#6c5ce7', color: '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer'
              }}>Copy</button>
              <button onClick={() => {
                const blob = new Blob([selected.content], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `${selected.company_name ?? 'memo'}.txt`;
                a.click();
              }} style={{
                padding: '10px 20px', background: 'rgba(255,255,255,0.08)', color: 'var(--text)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: 'pointer'
              }}>Download TXT</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
