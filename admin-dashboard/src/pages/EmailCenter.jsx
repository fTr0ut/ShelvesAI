import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import {
  uploadEmailImage,
  getResendAudiences,
  getEmailAudienceCount,
  sendEmailCampaign,
  getEmailCampaigns,
} from '../api/client';
import { getErrorMessage } from '../utils/errorUtils';

const APP_NAME = 'ShelvesAI';
const YEAR = new Date().getFullYear();

// ─── Email Templates ──────────────────────────────────────────────────────────

function buildShell({ headerBg, headerText, subject, bodyHtml }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:${headerBg};padding:30px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;">${APP_NAME}</h1>
    ${headerText ? `<p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px;">${headerText}</p>` : ''}
  </div>
  <div style="background:#ffffff;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;">© ${YEAR} ${APP_NAME}. All rights reserved.</p>
  </div>
</body>
</html>`;
}

const EMAIL_TEMPLATES = [
  {
    id: 'announcement',
    name: 'Announcement',
    description: 'General announcement with gradient header',
    accentFrom: '#6366f1',
    accentTo: '#8b5cf6',
    buildHtml: (subject, bodyHtml) =>
      buildShell({
        headerBg: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)',
        headerText: subject,
        subject,
        bodyHtml,
      }),
  },
  {
    id: 'update',
    name: 'Feature Update',
    description: 'Highlight a new feature or improvement',
    accentFrom: '#0ea5e9',
    accentTo: '#06b6d4',
    buildHtml: (subject, bodyHtml) =>
      buildShell({
        headerBg: 'linear-gradient(135deg,#0ea5e9 0%,#06b6d4 100%)',
        headerText: subject,
        subject,
        bodyHtml,
      }),
  },
  {
    id: 'newsletter',
    name: 'Newsletter',
    description: 'Multi-section newsletter layout',
    accentFrom: '#10b981',
    accentTo: '#059669',
    buildHtml: (subject, bodyHtml) =>
      buildShell({
        headerBg: 'linear-gradient(135deg,#10b981 0%,#059669 100%)',
        headerText: subject,
        subject,
        bodyHtml,
      }),
  },
  {
    id: 'plain',
    name: 'Plain',
    description: 'Minimal dark header, full HTML control',
    accentFrom: '#374151',
    accentTo: '#111827',
    buildHtml: (subject, bodyHtml) =>
      buildShell({
        headerBg: '#111827',
        headerText: null,
        subject,
        bodyHtml,
      }),
  },
];

// ─── Constants ────────────────────────────────────────────────────────────────

const DB_AUDIENCE_OPTIONS = [
  { value: 'all', label: 'All active users' },
  { value: 'premium', label: 'Premium users only' },
  { value: 'free', label: 'Free users only' },
  { value: 'new_7d', label: 'Joined in last 7 days' },
  { value: 'new_30d', label: 'Joined in last 30 days' },
  { value: 'admins', label: 'Admins only' },
];

const QUILL_FORMATS = ['bold', 'italic', 'underline', 'list', 'link', 'header', 'image'];

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmailCenter() {
  const quillRef = useRef(null);
  const imageInputRef = useRef(null);
  // Maps relative URL → absolute public URL for images uploaded this session
  const imageUrlMapRef = useRef(new Map());
  // Stable ref so the Quill handler closure always calls the latest version
  const imageHandlerFnRef = useRef(null);

  const [activeTab, setActiveTab] = useState('compose');
  const [selectedTemplate, setSelectedTemplate] = useState(EMAIL_TEMPLATES[0]);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [audienceType, setAudienceType] = useState('all');
  const [audienceCount, setAudienceCount] = useState(null);
  const [audienceCountLoading, setAudienceCountLoading] = useState(false);
  const [resendAudiences, setResendAudiences] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendResult, setSendResult] = useState(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState(null);

  // Image upload handler — called by Quill's custom toolbar handler
  function handleImageButtonClick() {
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
      imageInputRef.current.click();
    }
  }
  imageHandlerFnRef.current = handleImageButtonClick;

  async function handleImageFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageUploading(true);
    setImageUploadError(null);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await uploadEmailImage(formData);
      const { url, absoluteUrl } = res.data;
      // Track relative → absolute mapping so handleSend can produce email-safe HTML
      imageUrlMapRef.current.set(url, absoluteUrl);
      // Insert relative URL into editor — served via the Vite /media proxy in dev
      const quill = quillRef.current?.getEditor();
      if (quill) {
        const range = quill.getSelection(true);
        quill.insertEmbed(range.index, 'image', url);
        quill.setSelection(range.index + 1);
      }
    } catch {
      setImageUploadError('Image upload failed. Check file type and size (5 MB max).');
    } finally {
      setImageUploading(false);
    }
  }

  // Stable modules object — toolbar handlers use the ref so they never go stale
  const quillModules = useMemo(() => ({
    toolbar: {
      container: [
        ['bold', 'italic', 'underline'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['link', 'image'],
        [{ header: [1, 2, 3, false] }],
        ['clean'],
      ],
      handlers: {
        image: () => imageHandlerFnRef.current?.(),
      },
    },
  }), []);

  // Fetch Resend audiences on mount
  useEffect(() => {
    getResendAudiences()
      .then((res) => setResendAudiences(res.data.audiences || []))
      .catch(() => setResendAudiences([]));
  }, []);

  // Fetch audience count whenever audienceType changes
  useEffect(() => {
    let cancelled = false;
    setAudienceCount(null);
    setAudienceCountLoading(true);
    getEmailAudienceCount(audienceType)
      .then((res) => { if (!cancelled) setAudienceCount(res.data.count); })
      .catch(() => { if (!cancelled) setAudienceCount(null); })
      .finally(() => { if (!cancelled) setAudienceCountLoading(false); });
    return () => { cancelled = true; };
  }, [audienceType]);

  const loadCampaigns = useCallback(async () => {
    try {
      setCampaignsLoading(true);
      setCampaignsError(null);
      const res = await getEmailCampaigns();
      setCampaigns(res.data.campaigns);
    } catch (err) {
      setCampaignsError(getErrorMessage(err, 'Failed to load campaign history'));
    } finally {
      setCampaignsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'history') loadCampaigns();
  }, [activeTab, loadCampaigns]);

  const isBodyEmpty = bodyHtml === '' || bodyHtml === '<p><br></p>';
  const canSend = subject.trim() !== '' && !isBodyEmpty && !sending;

  async function handleSend(e) {
    e.preventDefault();
    if (!canSend) return;

    // Build email HTML, then swap every relative image URL for its absolute counterpart
    // so email clients (which have no base URL) can load the images.
    let emailHtml = selectedTemplate.buildHtml(subject.trim(), bodyHtml);
    for (const [relUrl, absUrl] of imageUrlMapRef.current) {
      emailHtml = emailHtml.replaceAll(relUrl, absUrl);
    }

    const audienceLabel = audienceType.startsWith('resend:')
      ? (resendAudiences.find((a) => `resend:${a.id}` === audienceType)?.name || audienceType)
      : (DB_AUDIENCE_OPTIONS.find((o) => o.value === audienceType)?.label || audienceType);

    try {
      setSending(true);
      setSendError(null);
      setSendResult(null);
      const res = await sendEmailCampaign({
        templateId: selectedTemplate.id,
        subject: subject.trim(),
        emailHtml,
        audienceType,
        audienceLabel,
      });
      setSendResult(res.data);
      setSubject('');
      setBodyHtml('');
    } catch (err) {
      setSendError(getErrorMessage(err, 'Failed to send campaign'));
    } finally {
      setSending(false);
    }
  }

  const previewHtml = selectedTemplate.buildHtml(
    subject || '(subject preview)',
    bodyHtml || '<p><em style="color:#9ca3af">Your message content will appear here…</em></p>',
  );

  return (
    <div>
      {/* Header + Tab switcher */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Email Center</h1>
        <div className="flex border border-gray-300 rounded-lg overflow-hidden">
          <button
            onClick={() => setActiveTab('compose')}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === 'compose' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Compose
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === 'history' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            History
          </button>
        </div>
      </div>

      {/* ── Compose Tab ── */}
      {activeTab === 'compose' && (
        <div className="space-y-6">
          {/* Template Gallery */}
          <div className="bg-white shadow rounded-lg p-6">
            <p className="text-sm font-medium text-gray-700 mb-4">Choose a template</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {EMAIL_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTemplate(t)}
                  className={`text-left border-2 rounded-lg overflow-hidden transition-all focus:outline-none ${
                    selectedTemplate.id === t.id
                      ? 'border-blue-500 ring-2 ring-blue-100'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div
                    style={{
                      background: `linear-gradient(135deg, ${t.accentFrom} 0%, ${t.accentTo} 100%)`,
                    }}
                    className="h-10"
                  />
                  <div className="p-2.5">
                    <p className="text-xs font-semibold text-gray-800">{t.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-tight">{t.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Compose Form */}
          <div className="bg-white shadow rounded-lg p-6">
            <form onSubmit={handleSend} className="space-y-5">
              {/* Subject */}
              <div>
                <div className="flex justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Subject</label>
                  <span className="text-xs text-gray-400">{subject.length}/200</span>
                </div>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value.slice(0, 200))}
                  maxLength={200}
                  placeholder="Email subject line"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Rich Text Body */}
              <div>
                <div className="flex justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Body</label>
                  {imageUploading && (
                    <span className="text-xs text-blue-600 animate-pulse">Uploading image…</span>
                  )}
                </div>
                {imageUploadError && (
                  <p className="mb-1 text-xs text-red-600">{imageUploadError}</p>
                )}
                <div className="rounded-md overflow-hidden border border-gray-300">
                  <ReactQuill
                    ref={quillRef}
                    theme="snow"
                    value={bodyHtml}
                    onChange={setBodyHtml}
                    modules={quillModules}
                    formats={QUILL_FORMATS}
                    placeholder="Write your message…"
                    style={{ minHeight: '180px' }}
                  />
                </div>
                {/* Hidden file input triggered by the Quill image toolbar button */}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handleImageFileChange}
                />
              </div>

              {/* Audience + Actions row */}
              <div className="border-t pt-4 flex flex-col sm:flex-row sm:items-end gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Audience</label>
                  <div className="flex items-center gap-3">
                    <select
                      value={audienceType}
                      onChange={(e) => setAudienceType(e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <optgroup label="User Database">
                        {DB_AUDIENCE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </optgroup>
                      {resendAudiences.length > 0 && (
                        <optgroup label="Resend Audiences">
                          {resendAudiences.map((a) => (
                            <option key={a.id} value={`resend:${a.id}`}>
                              {a.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    <span className="whitespace-nowrap text-sm">
                      {audienceCountLoading ? (
                        <span className="text-gray-400 text-xs">…</span>
                      ) : audienceCount !== null ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {audienceCount.toLocaleString()} recipients
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 sm:flex-none">
                  <button
                    type="button"
                    onClick={() => setShowPreview((v) => !v)}
                    className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    {showPreview ? 'Hide Preview' : 'Preview'}
                  </button>
                  <button
                    type="submit"
                    disabled={!canSend}
                    className="px-5 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {sending ? 'Sending…' : 'Send Campaign →'}
                  </button>
                </div>
              </div>

              {/* Feedback banners */}
              {sendError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-700">{sendError}</p>
                </div>
              )}
              {sendResult && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-sm text-green-700">
                    Campaign sent — {sendResult.sent.toLocaleString()} delivered
                    {sendResult.failed > 0 && `, ${sendResult.failed.toLocaleString()} failed`}.
                    {sendResult.simulated && ' (simulated — RESEND_API_KEY not configured)'}
                  </p>
                </div>
              )}
            </form>
          </div>

          {/* Preview Panel */}
          {showPreview && (
            <div className="bg-white shadow rounded-lg p-6">
              <p className="text-sm font-medium text-gray-700 mb-4">
                Email Preview —{' '}
                <span
                  style={{
                    background: `linear-gradient(135deg, ${selectedTemplate.accentFrom} 0%, ${selectedTemplate.accentTo} 100%)`,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    fontWeight: 600,
                  }}
                >
                  {selectedTemplate.name}
                </span>
              </p>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <iframe
                  srcDoc={previewHtml}
                  title="Email preview"
                  className="w-full"
                  style={{ height: '520px', border: 'none' }}
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── History Tab ── */}
      {activeTab === 'history' && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium text-gray-900">Campaign History</h3>

            {campaignsError && (
              <p className="mt-3 text-sm text-red-600">{campaignsError}</p>
            )}

            {campaignsLoading ? (
              <p className="mt-4 text-sm text-gray-500">Loading…</p>
            ) : campaigns.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">No campaigns sent yet.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Sent', 'Subject', 'Template', 'Audience', 'Recipients', 'Sent / Failed', 'Status'].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {campaigns.map((c) => {
                      const template = EMAIL_TEMPLATES.find((t) => t.id === c.templateId);
                      return (
                        <tr key={c.id}>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {new Date(c.sentAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-gray-900 max-w-[180px] truncate">{c.subject}</td>
                          <td className="px-4 py-3">
                            {template ? (
                              <span
                                className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white"
                                style={{
                                  background: `linear-gradient(135deg, ${template.accentFrom} 0%, ${template.accentTo} 100%)`,
                                }}
                              >
                                {template.name}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-xs">{c.templateId}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate">
                            {c.audienceLabel || c.audienceType}
                          </td>
                          <td className="px-4 py-3 text-gray-900">{c.recipientCount.toLocaleString()}</td>
                          <td className="px-4 py-3">
                            <span className="text-green-700">{c.sentCount.toLocaleString()}</span>
                            {' / '}
                            <span className="text-red-600">{c.failedCount.toLocaleString()}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                c.status === 'sent'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {c.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
