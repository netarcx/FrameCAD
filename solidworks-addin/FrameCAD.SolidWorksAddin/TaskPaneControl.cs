using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using FrameCAD.SolidWorksAddin.Models;

namespace FrameCAD.SolidWorksAddin
{
    public class TaskPaneControl : UserControl
    {
        private readonly FrameCadApiClient _api = new FrameCadApiClient();
        private Timer _healthTimer;
        private string _currentFilePath;
        private bool _busy;
        private bool _disposed;

        private const int Pad = 12;
        private const int BtnHeight = 44;
        private const int BtnGap = 6;
        private const int SectionGap = 20;
        private const int HeaderHeight = 48;
        private const int LogoSize = 32;

        // Slate Grey + Purple
        static readonly Color CBase = Color.FromArgb(28, 31, 38);
        static readonly Color CMantle = Color.FromArgb(22, 25, 32);
        static readonly Color CSurface0 = Color.FromArgb(40, 44, 52);
        static readonly Color CSurface1 = Color.FromArgb(53, 58, 69);
        static readonly Color COverlay0 = Color.FromArgb(107, 112, 128);
        static readonly Color CSubtext = Color.FromArgb(160, 165, 180);
        static readonly Color CText = Color.FromArgb(220, 223, 230);
        static readonly Color CBlue = Color.FromArgb(167, 139, 250);
        static readonly Color CGreen = Color.FromArgb(134, 239, 172);
        static readonly Color CRed = Color.FromArgb(251, 113, 133);
        static readonly Color CYellow = Color.FromArgb(252, 211, 77);

        private StatusDot _dot;
        private Label _lblConnection;
        private Panel _pnlConnection;
        private PictureBox _logo;
        private Label _title;

        private Panel _pnlFileCard;
        private Label _lblFileName;
        private Label _lblPartNumber;
        private Label _lblDescription;
        private Label _lblStatus;
        private Label _lblLockedBy;
        // Warning shown when the active file's name doesn't include its
        // FrameCAD part number — likely the user did a Save As and broke
        // the parts.json link to this file
        private Label _lblRenameWarning;

        private Button _btnCheckOut, _btnCheckIn;
        private Button _btnSync, _btnPublish;
        private Button _btnNewPart;
        private Button _btnOpenApp;
        private Label _lblMessage;

        // Per-part metadata panel (release state + comments + material)
        private Panel _pnlMeta;
        private Label _lblReleaseLabel;
        private ComboBox _cmbReleaseState;
        private Label _lblMaterialLabel;
        private Label _lblMaterialValue;
        private Button _btnUseSwMaterial;
        private Label _lblMethodLabel;
        private ComboBox _cmbMfgMethod;
        private Label _lblCommentsLabel;
        private ListBox _lstComments;
        private TextBox _txtComment;
        private Button _btnAddComment;
        // True while we're programmatically setting the combo from
        // freshly-loaded metadata — suppresses the SelectedIndexChanged
        // handler from re-saving the state right back to the server.
        private bool _suppressReleaseChange;
        private bool _suppressMethodChange;

        // "Newer version available" banner shown when origin has a commit
        // ahead of HEAD that touched the active document
        private Panel _pnlNewerVersion;
        private Label _lblNewerVersion;
        private Button _btnDownloadNewer;

        // "Fill title block" button — only meaningful for drawings, hidden otherwise
        private Button _btnFillTitleBlock;

        /// <summary>
        /// Read the SolidWorks-assigned material name for the active document.
        /// Wired by SwAddin so TaskPaneControl can ask without holding a SW
        /// API reference. Returns empty string on any failure.
        /// </summary>
        public Func<string> OnGetActiveDocMaterial;

        /// <summary>
        /// Write a set of values to the active drawing's custom properties.
        /// Returns the count successfully written. Wired by SwAddin.
        /// </summary>
        public Func<System.Collections.Generic.IDictionary<string, string>, int> OnFillTitleBlock;

        /// <summary>
        /// Called by SwAddin's FileSavePostNotify hook with the part's
        /// new mass (in pounds). Pushes to FrameCAD's REST API in the
        /// background — fire-and-forget so SW's save event isn't blocked.
        /// Failures are silently ignored; the user can still set mass
        /// manually if the auto-push misses.
        /// </summary>
        public async void NotifyPartMassFromSwAsync(string absolutePath, double massPounds)
        {
            if (string.IsNullOrEmpty(absolutePath) || massPounds <= 0) return;
            try { await _api.SetPartMassAutoAsync(absolutePath, massPounds); }
            catch { /* silent — SW save must not be blocked by network issues */ }
        }

        public TaskPaneControl()
        {
            SetStyle(ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = CBase;
            AutoScroll = true;
            BuildUI();
            Resize += (s, e) => LayoutAll();
        }

        private void BuildUI()
        {
            // --- Header ---
            var version = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;

            // Logo loaded from disk (copied alongside the DLL by the csproj)
            try
            {
                var dllDir = System.IO.Path.GetDirectoryName(
                    System.Reflection.Assembly.GetExecutingAssembly().Location);
                var logoPath = System.IO.Path.Combine(dllDir ?? "", "logo.png");
                if (System.IO.File.Exists(logoPath))
                {
                    _logo = new PictureBox
                    {
                        Image = Image.FromFile(logoPath),
                        SizeMode = PictureBoxSizeMode.Zoom,
                        Size = new Size(LogoSize, LogoSize),
                        Location = new Point(Pad, 8),
                        BackColor = Color.Transparent
                    };
                    Controls.Add(_logo);
                }
            }
            catch { /* missing logo is non-fatal */ }

            _title = new Label
            {
                Text = $"FrameCAD v{version.Major}.{version.Minor}.{version.Build}",
                Font = new Font("Segoe UI Semibold", 11f),
                ForeColor = CText,
                Location = new Point(Pad + LogoSize + 8, 16),
                AutoSize = false,
                AutoEllipsis = true,
                TextAlign = ContentAlignment.MiddleLeft,
                Size = new Size(160, 22)
            };
            Controls.Add(_title);

            // --- Connection ---
            _pnlConnection = new Panel { Size = new Size(200, 20) };
            _dot = new StatusDot { Location = new Point(0, 5), BackColor = Color.Transparent };
            _dot.DotColor = COverlay0;
            _pnlConnection.Controls.Add(_dot);
            _lblConnection = new Label
            {
                Text = "Checking...",
                ForeColor = CSubtext,
                Font = new Font("Segoe UI", 8.25f),
                Location = new Point(14, 2),
                AutoSize = false,
                AutoEllipsis = true,
                TextAlign = ContentAlignment.MiddleLeft,
                Size = new Size(180, 16)
            };
            _pnlConnection.Controls.Add(_lblConnection);
            Controls.Add(_pnlConnection);

            // --- File info card ---
            _pnlFileCard = new Panel
            {
                BackColor = CSurface0,
                Visible = false
            };

            var cardY = 10;
            _lblFileName = MakeLabel(_pnlFileCard, ref cardY, new Font("Segoe UI Semibold", 9.75f), CText);
            _lblPartNumber = MakeLabel(_pnlFileCard, ref cardY, new Font("Consolas", 9.5f), CBlue);
            _lblDescription = MakeLabel(_pnlFileCard, ref cardY, new Font("Segoe UI", 8.25f), CSubtext);
            cardY += 4;
            _lblStatus = MakeLabel(_pnlFileCard, ref cardY, new Font("Segoe UI", 8.25f), CSubtext);
            _lblLockedBy = MakeLabel(_pnlFileCard, ref cardY, new Font("Segoe UI", 8.25f), CSubtext);
            _lblRenameWarning = MakeLabel(_pnlFileCard, ref cardY, new Font("Segoe UI Semibold", 8.25f), CYellow);
            _lblRenameWarning.Visible = false;
            Controls.Add(_pnlFileCard);

            // --- Buttons ---
            _btnCheckOut = MakeButton("Check Out");
            _btnCheckOut.Click += async (s, e) => await DoCheckOut();
            Controls.Add(_btnCheckOut);

            _btnCheckIn = MakeButton("Check In");
            _btnCheckIn.Click += async (s, e) => await DoCheckIn();
            Controls.Add(_btnCheckIn);

            _btnSync = MakeButton("Download");
            _btnSync.Click += async (s, e) => await DoSync();
            Controls.Add(_btnSync);

            _btnPublish = MakeButton("Upload");
            _btnPublish.Click += async (s, e) => await DoPublish();
            Controls.Add(_btnPublish);

            _btnNewPart = MakeButton("New Part / Assembly");
            _btnNewPart.Click += async (s, e) => await DoNewPart();
            Controls.Add(_btnNewPart);

            _btnFillTitleBlock = MakeButton("Fill Title Block");
            _btnFillTitleBlock.Click += async (s, e) => await DoFillTitleBlock();
            _btnFillTitleBlock.Visible = false;  // only for .slddrw documents
            Controls.Add(_btnFillTitleBlock);

            _btnOpenApp = MakeButton("Open FrameCAD");
            _btnOpenApp.BackColor = CBlue;
            _btnOpenApp.ForeColor = CMantle;
            _btnOpenApp.Font = new Font("Segoe UI Semibold", 11f);
            _btnOpenApp.FlatAppearance.BorderSize = 0;
            _btnOpenApp.FlatAppearance.MouseOverBackColor = Color.FromArgb(196, 181, 253);
            _btnOpenApp.Enabled = true;
            _btnOpenApp.Click += (s, e) => DoOpenApp();
            Controls.Add(_btnOpenApp);

            _lblMessage = new Label
            {
                Text = "",
                ForeColor = CSubtext,
                Font = new Font("Segoe UI", 8f),
                AutoSize = false,
                Size = new Size(200, 32)
            };
            Controls.Add(_lblMessage);

            BuildMetaPanel();

            SetButtonStates(false, false);
            LayoutAll();
        }

        private void BuildMetaPanel()
        {
            _pnlMeta = new Panel { BackColor = CSurface0, Visible = false };

            var y = 10;

            _lblReleaseLabel = new Label
            {
                Text = "Release state",
                ForeColor = CSubtext,
                Font = new Font("Segoe UI", 8.25f),
                Location = new Point(10, y),
                AutoSize = false,
                Size = new Size(180, 16)
            };
            _pnlMeta.Controls.Add(_lblReleaseLabel);
            y += 18;

            _cmbReleaseState = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                FlatStyle = FlatStyle.Flat,
                BackColor = CSurface1,
                ForeColor = CText,
                Font = new Font("Segoe UI", 9.5f),
                Location = new Point(10, y),
                Size = new Size(180, 24)
            };
            _cmbReleaseState.Items.AddRange(new object[] { "draft", "in-review", "released", "manufactured" });
            _cmbReleaseState.SelectedIndexChanged += async (s, e) =>
            {
                if (_suppressReleaseChange) return;
                await DoSetReleaseState();
            };
            _pnlMeta.Controls.Add(_cmbReleaseState);
            y += 30;

            _lblMaterialLabel = new Label
            {
                Text = "Material",
                ForeColor = CSubtext,
                Font = new Font("Segoe UI", 8.25f),
                Location = new Point(10, y),
                AutoSize = false,
                Size = new Size(180, 16)
            };
            _pnlMeta.Controls.Add(_lblMaterialLabel);
            y += 18;

            _lblMaterialValue = new Label
            {
                Text = "(not set)",
                ForeColor = CText,
                Font = new Font("Segoe UI", 9f),
                Location = new Point(10, y),
                AutoSize = false,
                AutoEllipsis = true,
                TextAlign = ContentAlignment.MiddleLeft,
                Size = new Size(116, 22)
            };
            _pnlMeta.Controls.Add(_lblMaterialValue);

            _btnUseSwMaterial = new Button
            {
                Text = "Use SW",
                FlatStyle = FlatStyle.Flat,
                BackColor = CSurface1,
                ForeColor = CText,
                Font = new Font("Segoe UI", 9f),
                Location = new Point(130, y),
                Size = new Size(60, 22),
                Cursor = Cursors.Hand,
                FlatAppearance = { BorderSize = 0 }
            };
            _btnUseSwMaterial.Click += async (s, e) => await DoUseSwMaterial();
            _pnlMeta.Controls.Add(_btnUseSwMaterial);
            y += 28;

            // Manufacturing method — required for released parts to land
            // on the right tab of FrameCAD's shop-floor queue. Mirrors
            // the desktop DetailsPanel's method picker.
            _lblMethodLabel = new Label
            {
                Text = "Method",
                ForeColor = CSubtext,
                Font = new Font("Segoe UI", 8.25f),
                Location = new Point(10, y),
                AutoSize = false,
                Size = new Size(180, 16)
            };
            _pnlMeta.Controls.Add(_lblMethodLabel);
            y += 18;

            _cmbMfgMethod = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                FlatStyle = FlatStyle.Flat,
                BackColor = CSurface1,
                ForeColor = CText,
                Font = new Font("Segoe UI", 9.5f),
                Location = new Point(10, y),
                Size = new Size(180, 24)
            };
            // "(not set)" sentinel maps to a null write so the user can
            // clear the field from the add-in too.
            _cmbMfgMethod.Items.AddRange(new object[] { "(not set)", "print", "cnc", "manual", "other" });
            _cmbMfgMethod.SelectedIndexChanged += async (s, e) =>
            {
                if (_suppressMethodChange) return;
                await DoSetMfgMethod();
            };
            _pnlMeta.Controls.Add(_cmbMfgMethod);
            y += 30;

            _lblCommentsLabel = new Label
            {
                Text = "Comments",
                ForeColor = CSubtext,
                Font = new Font("Segoe UI", 8.25f),
                Location = new Point(10, y),
                AutoSize = false,
                Size = new Size(180, 16)
            };
            _pnlMeta.Controls.Add(_lblCommentsLabel);
            y += 18;

            _lstComments = new ListBox
            {
                BackColor = CMantle,
                ForeColor = CText,
                Font = new Font("Segoe UI", 8.5f),
                BorderStyle = BorderStyle.None,
                Location = new Point(10, y),
                Size = new Size(180, 80),
                IntegralHeight = false
            };
            _pnlMeta.Controls.Add(_lstComments);
            y += 86;

            _txtComment = new TextBox
            {
                BackColor = CSurface1,
                ForeColor = CText,
                Font = new Font("Segoe UI", 9f),
                BorderStyle = BorderStyle.FixedSingle,
                Location = new Point(10, y),
                Size = new Size(120, 22)
            };
            _pnlMeta.Controls.Add(_txtComment);

            _btnAddComment = new Button
            {
                Text = "Add",
                FlatStyle = FlatStyle.Flat,
                BackColor = CBlue,
                ForeColor = CMantle,
                Font = new Font("Segoe UI Semibold", 9f),
                Location = new Point(134, y),
                Size = new Size(56, 22),
                Cursor = Cursors.Hand,
                FlatAppearance = { BorderSize = 0 }
            };
            _btnAddComment.Click += async (s, e) => await DoAddComment();
            _pnlMeta.Controls.Add(_btnAddComment);
            y += 28;

            _pnlMeta.Height = y;
            Controls.Add(_pnlMeta);

            // "Newer version available" banner — separate panel so it can
            // appear without the meta panel (or vice versa)
            _pnlNewerVersion = new Panel
            {
                BackColor = CYellow,
                Visible = false,
                Height = 56
            };
            _lblNewerVersion = new Label
            {
                Text = "A teammate uploaded a newer version of this file",
                ForeColor = CMantle,
                Font = new Font("Segoe UI Semibold", 9f),
                Location = new Point(10, 8),
                AutoSize = false,
                Size = new Size(180, 24)
            };
            _pnlNewerVersion.Controls.Add(_lblNewerVersion);
            _btnDownloadNewer = new Button
            {
                Text = "Download",
                FlatStyle = FlatStyle.Flat,
                BackColor = CMantle,
                ForeColor = CYellow,
                Font = new Font("Segoe UI Semibold", 9f),
                Location = new Point(10, 30),
                Size = new Size(110, 22),
                Cursor = Cursors.Hand,
                FlatAppearance = { BorderSize = 0 }
            };
            _btnDownloadNewer.Click += async (s, e) => { await DoSync(); };
            _pnlNewerVersion.Controls.Add(_btnDownloadNewer);
            Controls.Add(_pnlNewerVersion);
        }

        private void LayoutAll()
        {
            var w = ClientSize.Width - Pad * 2;
            if (w < 40) return;

            // Header (logo + title) — reposition every layout pass so a
            // resized pane keeps things aligned
            if (_logo != null) _logo.Location = new Point(Pad, 8);
            if (_title != null)
            {
                _title.Location = new Point(Pad + LogoSize + 8, 16);
                _title.Width = Math.Max(40, w - LogoSize - 8);
            }
            var y = HeaderHeight + 8;

            _pnlConnection.Location = new Point(Pad, y);
            _pnlConnection.Width = w;
            _lblConnection.Width = Math.Max(40, w - 18);
            y += 28;

            if (_pnlFileCard.Visible)
            {
                _pnlFileCard.Location = new Point(Pad, y);
                _pnlFileCard.Width = w;

                var labelW = Math.Max(40, w - 20);
                foreach (Control c in _pnlFileCard.Controls)
                {
                    if (c is Label lbl) lbl.Width = labelW;
                }

                var cardH = 10;
                foreach (Control c in _pnlFileCard.Controls)
                {
                    if (c is Label lbl && lbl.Visible && !string.IsNullOrEmpty(lbl.Text))
                        cardH = Math.Max(cardH, c.Bottom + 8);
                }
                _pnlFileCard.Height = cardH;
                y += cardH + SectionGap;
            }

            // Newer-version banner sits at the top of per-file content —
            // it's the most urgent thing to see, before action buttons
            if (_pnlNewerVersion != null && _pnlNewerVersion.Visible)
            {
                _pnlNewerVersion.Location = new Point(Pad, y);
                _pnlNewerVersion.Width = w;
                _lblNewerVersion.Width = Math.Max(40, w - 20);
                _btnDownloadNewer.Width = Math.Max(60, w - 20);
                y += _pnlNewerVersion.Height + BtnGap;
            }

            // Meta panel sits between the file card and the action buttons —
            // it's per-file context (release state, material, comments) so
            // it belongs close to the file info, not at the bottom of the pane.
            if (_pnlMeta != null && _pnlMeta.Visible)
            {
                _pnlMeta.Location = new Point(Pad, y);
                _pnlMeta.Width = w;
                var inner = Math.Max(40, w - 20);
                _lblReleaseLabel.Width = inner;
                _cmbReleaseState.Width = inner;
                _lblMaterialLabel.Width = inner;
                _lblMethodLabel.Width = inner;
                _cmbMfgMethod.Width = inner;
                _lblCommentsLabel.Width = inner;
                _lstComments.Width = inner;
                _txtComment.Width = Math.Max(40, inner - 64);
                _btnAddComment.Location = new Point(10 + _txtComment.Width + 4, _txtComment.Location.Y);
                // Material value + Use-SW button share a row; let value
                // take whatever's left after the 60-px button
                _lblMaterialValue.Width = Math.Max(40, inner - 64);
                _btnUseSwMaterial.Location = new Point(10 + _lblMaterialValue.Width + 4, _lblMaterialValue.Location.Y);
                y += _pnlMeta.Height + SectionGap;
            }

            PlaceButton(_btnCheckOut, ref y, w);
            PlaceButton(_btnCheckIn, ref y, w);
            y += SectionGap - BtnGap;

            PlaceButton(_btnSync, ref y, w);
            PlaceButton(_btnPublish, ref y, w);
            y += SectionGap - BtnGap;

            PlaceButton(_btnNewPart, ref y, w);
            if (_btnFillTitleBlock != null && _btnFillTitleBlock.Visible)
            {
                PlaceButton(_btnFillTitleBlock, ref y, w);
            }
            y += SectionGap - BtnGap;

            PlaceButton(_btnOpenApp, ref y, w);
            y += 8;

            _lblMessage.Location = new Point(Pad, y);
            _lblMessage.Width = w;
        }

        private void PlaceButton(Button btn, ref int y, int w)
        {
            btn.Location = new Point(Pad, y);
            btn.Width = w;
            y += BtnHeight + BtnGap;
        }

        private Label MakeLabel(Control parent, ref int y, Font font, Color color)
        {
            var rowH = (int)(font.GetHeight() + 4);
            var lbl = new Label
            {
                ForeColor = color,
                Font = font,
                Location = new Point(10, y),
                AutoSize = false,
                AutoEllipsis = true,
                TextAlign = ContentAlignment.MiddleLeft,
                Size = new Size(180, rowH)
            };
            parent.Controls.Add(lbl);
            y += rowH + 4;
            return lbl;
        }

        private Button MakeButton(string text)
        {
            var btn = new Button
            {
                Text = text,
                FlatStyle = FlatStyle.Flat,
                BackColor = CSurface0,
                ForeColor = CText,
                Font = new Font("Segoe UI", 11f),
                Size = new Size(200, BtnHeight),
                Cursor = Cursors.Hand,
                FlatAppearance =
                {
                    BorderColor = CSurface1,
                    MouseOverBackColor = CSurface1
                },
                Enabled = false
            };
            return btn;
        }

        private void SafeInvoke(Action action)
        {
            if (_disposed || IsDisposed || !IsHandleCreated) return;
            try { BeginInvoke(action); } catch (ObjectDisposedException) { }
        }

        private bool _connected;
        private string _currentProjectPath;
        private bool _processingPending;

        public Action<string> OnProjectPathChanged { get; set; }
        public Func<string, bool, string> OnCreateSolidWorksFile { get; set; }
        public Func<string, System.Threading.Tasks.Task> OnStageFile { get; set; }
        public Func<string, System.Collections.Generic.List<string>> OnGetAssemblyChildren { get; set; }

        // Cached last-known file-state-derived button availability. We
        // remember these so the 5-second health tick can refresh the
        // connection-dependent buttons (Sync / Upload / + Part) without
        // clobbering Check Out / Check In, which is driven by the active
        // doc's lock state — UpdateFileDisplay is the only place that
        // should change those.
        private bool _lastCanCheckOut;
        private bool _lastCanCheckIn;

        private void SetButtonStates(bool canCheckOut, bool canCheckIn)
        {
            _lastCanCheckOut = canCheckOut;
            _lastCanCheckIn = canCheckIn;
            ApplyButtonStates();
        }

        private void ApplyButtonStates()
        {
            _btnCheckOut.Enabled = _connected && _lastCanCheckOut && !_busy;
            _btnCheckIn.Enabled = _connected && _lastCanCheckIn && !_busy;
            _btnSync.Enabled = _connected && !_busy;
            _btnPublish.Enabled = _connected && !_busy;
            _btnNewPart.Enabled = _connected && !_busy;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _disposed = true;
                _healthTimer?.Stop();
                _healthTimer?.Dispose();
            }
            base.Dispose(disposing);
        }

        public void StartHealthPolling()
        {
            _healthTimer = new Timer { Interval = 5000 };
            _healthTimer.Tick += async (s, e) => await CheckConnection();
            _healthTimer.Start();
            _ = CheckConnection();
        }

        public void StopHealthPolling()
        {
            _healthTimer?.Stop();
            _healthTimer?.Dispose();
        }

        private async System.Threading.Tasks.Task CheckConnection()
        {
            var wasConnected = _connected;
            HealthResponse health = null;
            Exception error = null;
            try
            {
                health = await _api.GetHealthAsync();
            }
            catch (Exception ex)
            {
                error = ex;
            }

            if (error == null && health?.Running == true && health?.Project != null)
            {
                await ProcessPendingCreates();
            }

            SafeInvoke(() =>
            {
                if (error != null)
                {
                    _connected = false;
                    _dot.DotColor = CRed;
                    string label;
                    if (error is System.Net.Http.HttpRequestException)
                    {
                        // Connection refused / unreachable — almost always means the
                        // desktop app isn't running
                        label = "FrameCAD desktop app is not open";
                    }
                    else if (error is System.Threading.Tasks.TaskCanceledException)
                    {
                        label = "FrameCAD not responding";
                    }
                    else
                    {
                        var msg = error.InnerException?.Message ?? error.Message;
                        if (msg.Length > 60) msg = msg.Substring(0, 57) + "...";
                        label = "Error: " + msg;
                    }
                    _lblConnection.Text = label;
                    SetButtonStates(false, false);
                    return;
                }

                var isConnected = health?.Running == true;
                var hasProject = health?.Project != null;
                _connected = isConnected && hasProject;
                if (isConnected && hasProject)
                {
                    _dot.DotColor = CGreen;
                    _lblConnection.Text = health.Project.Name;
                    // Re-apply (don't reset) — keeps the file-state buttons
                    // alive across 5-second health ticks
                    ApplyButtonStates();
                    if (!string.IsNullOrEmpty(health.Project.Path) && _currentProjectPath != health.Project.Path)
                    {
                        _currentProjectPath = health.Project.Path;
                        OnProjectPathChanged?.Invoke(health.Project.Path);
                    }
                    if (!wasConnected && !string.IsNullOrEmpty(_currentFilePath))
                        UpdateForDocument(_currentFilePath);
                }
                else if (isConnected)
                {
                    _currentProjectPath = null;
                    _dot.DotColor = CYellow;
                    _lblConnection.Text = "No Project Open";
                    SetButtonStates(false, false);
                }
                else
                {
                    _dot.DotColor = CRed;
                    _lblConnection.Text = "Not Running";
                    SetButtonStates(false, false);
                }
            });
        }

        private async System.Threading.Tasks.Task ProcessPendingCreates()
        {
            if (_processingPending) return;
            _processingPending = true;
            try
            {
                var pending = await _api.GetPendingCreatesAsync();
                if (pending == null) return;
                foreach (var p in pending)
                {
                    if (string.IsNullOrEmpty(p?.AbsolutePath)) continue;
                    var isAssembly = p.Type == "assembly";
                    // CheckConnection runs on the WinForms UI thread (Timer.Tick fires there and
                    // the continuation preserves the SynchronizationContext), so it's safe to
                    // call into the SolidWorks COM API directly here.
                    var error = OnCreateSolidWorksFile?.Invoke(p.AbsolutePath, isAssembly);
                    // Always mark done so a broken pending entry doesn't loop forever
                    try { await _api.MarkPendingDoneAsync(p.Id); } catch { }
                    if (error == null)
                    {
                        if (OnStageFile != null && !string.IsNullOrEmpty(p.RelativePath))
                        {
                            try { await OnStageFile(p.RelativePath); } catch { }
                        }
                        // Refresh the task pane for the new active doc — SolidWorks
                        // doesn't always fire ActiveDocChangeNotify for a doc that
                        // becomes active via NewPart/SaveAs, so the file would
                        // otherwise appear "Not tracked" until the user edits it
                        UpdateForDocument(p.AbsolutePath);
                        ShowMessage("Created " + (p.PartNumber ?? System.IO.Path.GetFileName(p.AbsolutePath)));
                    }
                    else
                    {
                        ShowMessage("Create failed: " + error, true);
                    }
                }
            }
            catch
            {
                // Ignore network/HTTP errors here; the next health tick will retry
            }
            finally
            {
                _processingPending = false;
            }
        }

        public async void UpdateForDocument(string absolutePath)
        {
            _currentFilePath = absolutePath;

            // Toggle drawing-only buttons immediately so the user doesn't see
            // them flash on for non-drawings before the API call returns
            var isDrawing = !string.IsNullOrEmpty(absolutePath) &&
                absolutePath.EndsWith(".slddrw", StringComparison.OrdinalIgnoreCase);
            SafeInvoke(() => {
                if (_btnFillTitleBlock != null)
                {
                    _btnFillTitleBlock.Visible = isDrawing;
                    LayoutAll();
                }
            });

            try
            {
                var file = await _api.GetFileAsync(absolutePath);
                if (_currentFilePath != absolutePath) return;
                SafeInvoke(() => {
                    UpdateFileDisplay(file, absolutePath);
                    UpdateNewerVersionBanner(file?.NewerOnRemote == true);
                });
            }
            catch
            {
                if (_currentFilePath != absolutePath) return;
                SafeInvoke(() =>
                {
                    ShowFileCard(System.IO.Path.GetFileName(absolutePath), "", "", "Not tracked", COverlay0, "");
                    SetButtonStates(false, false);
                    UpdateNewerVersionBanner(false);
                });
            }

            // Fetch metadata in parallel — release state + comments + material.
            // Best effort: if it fails (file not in parts.json), hide the panel.
            try
            {
                var meta = await _api.GetPartMetaAsync(absolutePath);
                if (_currentFilePath != absolutePath) return;
                SafeInvoke(() => UpdateMetaDisplay(meta));
            }
            catch
            {
                if (_currentFilePath != absolutePath) return;
                SafeInvoke(() => HideMetaPanel());
            }
        }

        private void UpdateNewerVersionBanner(bool newer)
        {
            if (_pnlNewerVersion == null) return;
            var changed = _pnlNewerVersion.Visible != newer;
            _pnlNewerVersion.Visible = newer;
            if (changed) LayoutAll();
        }

        public void ClearDocument()
        {
            _currentFilePath = null;
            _pnlFileCard.Visible = false;
            HideMetaPanel();
            UpdateNewerVersionBanner(false);
            if (_btnFillTitleBlock != null) _btnFillTitleBlock.Visible = false;
            SetButtonStates(false, false);
            LayoutAll();
        }

        private async System.Threading.Tasks.Task DoFillTitleBlock()
        {
            if (string.IsNullOrEmpty(_currentFilePath)) return;
            if (OnFillTitleBlock == null)
            {
                ShowMessage("SolidWorks API not available", true);
                return;
            }
            _btnFillTitleBlock.Enabled = false;
            try
            {
                var data = await _api.GetTitleBlockDataAsync(_currentFilePath);
                if (data == null)
                {
                    ShowMessage("Could not fetch title-block data from FrameCAD.", true);
                    return;
                }
                var props = new System.Collections.Generic.Dictionary<string, string>
                {
                    { "PartNumber", data.PartNumber ?? "" },
                    { "Description", data.Description ?? "" },
                    { "Material", data.Material ?? "" },
                    { "Mass", data.Mass ?? "" },
                    { "Designer", data.Designer ?? "" },
                    { "Date", data.Date ?? "" }
                };
                var written = OnFillTitleBlock(props);
                if (written > 0)
                {
                    ShowMessage($"Wrote {written} title-block field{(written == 1 ? "" : "s")}. " +
                        "Drawing template must reference \"PartNumber\", \"Description\", " +
                        "\"Material\", \"Mass\", \"Designer\", \"Date\" via $PRPSHEET / $PRP.",
                        false);
                }
                else
                {
                    ShowMessage("No title-block fields written — FrameCAD had no data for this drawing.", true);
                }
            }
            finally
            {
                _btnFillTitleBlock.Enabled = true;
            }
        }

        private void HideMetaPanel()
        {
            if (_pnlMeta == null) return;
            _pnlMeta.Visible = false;
            LayoutAll();
        }

        private void UpdateMetaDisplay(PartMetaDto meta)
        {
            if (_pnlMeta == null) return;
            if (meta == null)
            {
                HideMetaPanel();
                return;
            }

            // Populate release-state combo without firing the change
            // handler (which would re-save the state we just loaded).
            _suppressReleaseChange = true;
            try
            {
                var state = meta.Release?.State ?? "draft";
                var idx = _cmbReleaseState.Items.IndexOf(state);
                _cmbReleaseState.SelectedIndex = idx >= 0 ? idx : 0;
            }
            finally
            {
                _suppressReleaseChange = false;
            }

            _lblMaterialValue.Text = string.IsNullOrWhiteSpace(meta.ManufacturingMaterial)
                ? "(not set)"
                : meta.ManufacturingMaterial;

            // Populate the manufacturing-method combo without firing
            // the change handler (same pattern as release state).
            _suppressMethodChange = true;
            try
            {
                var method = meta.ManufacturingMethod;
                if (string.IsNullOrEmpty(method))
                {
                    _cmbMfgMethod.SelectedIndex = 0; // "(not set)"
                }
                else
                {
                    var idx = _cmbMfgMethod.Items.IndexOf(method);
                    _cmbMfgMethod.SelectedIndex = idx >= 0 ? idx : 0;
                }
            }
            finally
            {
                _suppressMethodChange = false;
            }

            // Render comments newest-first, cap at 8 entries to keep the
            // pane compact. Each line shows "<author>: <truncated text>".
            _lstComments.Items.Clear();
            if (meta.Comments != null && meta.Comments.Count > 0)
            {
                var ordered = meta.Comments
                    .OrderByDescending(c => c.At ?? "")
                    .Take(8);
                foreach (var c in ordered)
                {
                    var text = (c.Text ?? "").Replace("\r", " ").Replace("\n", " ");
                    if (text.Length > 60) text = text.Substring(0, 57) + "...";
                    var author = string.IsNullOrEmpty(c.Author) ? "?" : c.Author;
                    _lstComments.Items.Add($"{author}: {text}");
                }
            }
            else
            {
                _lstComments.Items.Add("(no comments yet)");
            }

            _pnlMeta.Visible = true;
            LayoutAll();
        }

        private async System.Threading.Tasks.Task DoSetReleaseState()
        {
            if (string.IsNullOrEmpty(_currentFilePath)) return;
            var state = _cmbReleaseState.SelectedItem?.ToString();
            if (string.IsNullOrEmpty(state)) return;

            var result = await _api.SetReleaseStateAsync(_currentFilePath, state);
            if (result?.Success == true)
            {
                ShowMessage($"Release state set to {state}.", false);
            }
            else
            {
                ShowMessage(result?.Error ?? "Could not set release state", true);
            }
        }

        private async System.Threading.Tasks.Task DoSetMfgMethod()
        {
            if (string.IsNullOrEmpty(_currentFilePath)) return;
            var selected = _cmbMfgMethod.SelectedItem?.ToString();
            // "(not set)" — first item — clears the field via null payload.
            var method = (selected == "(not set)" || string.IsNullOrEmpty(selected)) ? null : selected;

            var result = await _api.SetManufacturingMethodAsync(_currentFilePath, method);
            if (result?.Success == true)
            {
                ShowMessage(method == null
                    ? "Manufacturing method cleared."
                    : $"Manufacturing method set to {method}.", false);
            }
            else
            {
                ShowMessage(result?.Error ?? "Could not set manufacturing method", true);
            }
        }

        private async System.Threading.Tasks.Task DoUseSwMaterial()
        {
            if (string.IsNullOrEmpty(_currentFilePath)) return;
            var swMaterial = OnGetActiveDocMaterial?.Invoke() ?? "";
            if (string.IsNullOrWhiteSpace(swMaterial))
            {
                ShowMessage("No material set on the active SolidWorks document.", true);
                return;
            }

            _btnUseSwMaterial.Enabled = false;
            try
            {
                var result = await _api.SetManufacturingMaterialAsync(_currentFilePath, swMaterial);
                if (result?.Success == true)
                {
                    SafeInvoke(() => _lblMaterialValue.Text = swMaterial);
                    ShowMessage($"Material set to \"{swMaterial}\".", false);
                }
                else
                {
                    ShowMessage(result?.Error ?? "Could not set material", true);
                }
            }
            finally
            {
                _btnUseSwMaterial.Enabled = true;
            }
        }

        private async System.Threading.Tasks.Task DoAddComment()
        {
            if (string.IsNullOrEmpty(_currentFilePath)) return;
            var text = _txtComment.Text?.Trim();
            if (string.IsNullOrEmpty(text)) return;

            _btnAddComment.Enabled = false;
            try
            {
                var result = await _api.AddCommentAsync(_currentFilePath, text);
                if (result?.Success == true)
                {
                    _txtComment.Text = "";
                    // Refresh comments list from server so we see what the
                    // server actually persisted (with author + timestamp)
                    var fresh = await _api.GetPartMetaAsync(_currentFilePath);
                    SafeInvoke(() => UpdateMetaDisplay(fresh));
                }
                else
                {
                    ShowMessage(result?.Error ?? "Could not add comment", true);
                }
            }
            finally
            {
                _btnAddComment.Enabled = true;
            }
        }

        private void ShowFileCard(string name, string partNum, string desc, string status, Color statusColor, string lockedBy)
        {
            _pnlFileCard.Visible = true;
            _lblFileName.Text = name ?? "";
            _lblPartNumber.Text = partNum ?? "";
            _lblPartNumber.Visible = !string.IsNullOrEmpty(partNum);
            _lblDescription.Text = desc ?? "";
            _lblDescription.Visible = !string.IsNullOrEmpty(desc);
            _lblStatus.Text = status;
            _lblStatus.ForeColor = statusColor;
            _lblLockedBy.Text = lockedBy ?? "";
            _lblLockedBy.Visible = !string.IsNullOrEmpty(lockedBy);

            // Rename guard: FrameCAD creates files pre-named with their
            // part number (e.g. "26-2129-01-005.sldprt"). If the file name
            // doesn't contain its assigned part number, someone Save-As-d
            // it to a different name and parts.json may no longer track
            // the new name. Surface this passively in the card.
            var renameMismatch = false;
            if (!string.IsNullOrEmpty(partNum) && !string.IsNullOrEmpty(name))
            {
                var nameWithoutExt = System.IO.Path.GetFileNameWithoutExtension(name) ?? "";
                if (nameWithoutExt.IndexOf(partNum, StringComparison.OrdinalIgnoreCase) < 0)
                {
                    renameMismatch = true;
                }
            }
            if (_lblRenameWarning != null)
            {
                _lblRenameWarning.Text = renameMismatch
                    ? "⚠ Filename doesn't contain the part number — may break tracking"
                    : "";
                _lblRenameWarning.Visible = renameMismatch;
            }

            LayoutAll();
        }

        private void UpdateFileDisplay(FileStatus file, string path)
        {
            if (file == null)
            {
                ShowFileCard(System.IO.Path.GetFileName(path), "", "", "Not tracked", COverlay0, "");
                SetButtonStates(false, false);
                return;
            }

            string statusText;
            Color statusColor;
            switch (file.State)
            {
                case "synced":
                    statusText = "Up to date";
                    statusColor = CGreen;
                    break;
                case "modified":
                    statusText = "Modified";
                    statusColor = CYellow;
                    break;
                case "untracked":
                    statusText = "New";
                    statusColor = COverlay0;
                    break;
                case "locked-by-you":
                    statusText = "Checked out by you";
                    statusColor = CBlue;
                    break;
                case "locked-by-other":
                    statusText = "Locked";
                    statusColor = CRed;
                    break;
                default:
                    statusText = file.State;
                    statusColor = CSubtext;
                    break;
            }

            var lockedText = !string.IsNullOrEmpty(file.LockedBy) ? file.LockedBy : "";
            ShowFileCard(file.Name, file.PartNumber, file.PartDescription, statusText, statusColor, lockedText);

            var canCheckOut = file.State != "locked-by-you" && file.State != "locked-by-other";
            var canCheckIn = file.State == "locked-by-you";
            SetButtonStates(canCheckOut, canCheckIn);
        }

        private void ShowMessage(string text, bool isError = false)
        {
            _lblMessage.Text = text;
            _lblMessage.ForeColor = isError ? CRed : CGreen;
        }

        private System.Collections.Generic.List<string> AssemblyTargets()
        {
            // When the active doc is an assembly, also operate on every child
            // component file. Returns the parent first, then any children.
            var targets = new System.Collections.Generic.List<string> { _currentFilePath };
            var ext = System.IO.Path.GetExtension(_currentFilePath).ToLowerInvariant();
            if (ext == ".sldasm" && OnGetAssemblyChildren != null)
            {
                try
                {
                    var children = OnGetAssemblyChildren(_currentFilePath);
                    if (children != null)
                    {
                        foreach (var c in children)
                        {
                            if (!string.IsNullOrEmpty(c) &&
                                !targets.Contains(c, StringComparer.OrdinalIgnoreCase))
                                targets.Add(c);
                        }
                    }
                }
                catch { /* fall back to single-file action */ }
            }
            return targets;
        }

        private async System.Threading.Tasks.Task DoCheckOut()
        {
            if (string.IsNullOrEmpty(_currentFilePath) || _busy) return;
            _busy = true;
            SetButtonStates(false, false);
            try
            {
                var targets = AssemblyTargets();
                int ok = 0, fail = 0;
                string lastError = null;
                foreach (var p in targets)
                {
                    try
                    {
                        var result = await _api.CheckOutAsync(p);
                        if (result != null && result.Success) ok++;
                        else { fail++; if (result?.Error != null) lastError = result.Error; }
                    }
                    catch (Exception ex) { fail++; lastError = ex.Message; }
                }
                SafeInvoke(() =>
                {
                    if (targets.Count == 1)
                    {
                        if (ok == 1) ShowMessage("Checked out");
                        else ShowMessage(lastError ?? "Check out failed", true);
                    }
                    else
                    {
                        ShowMessage($"Checked out {ok} of {targets.Count} (assembly + children)",
                            fail > 0);
                    }
                });
                UpdateForDocument(_currentFilePath);
            }
            catch (Exception ex) { SafeInvoke(() => ShowMessage(ex.Message, true)); }
            finally { _busy = false; }
        }

        private async System.Threading.Tasks.Task DoCheckIn()
        {
            if (string.IsNullOrEmpty(_currentFilePath) || _busy) return;
            _busy = true;
            SetButtonStates(false, false);
            try
            {
                var targets = AssemblyTargets();
                int ok = 0, fail = 0;
                string lastError = null;
                foreach (var p in targets)
                {
                    try
                    {
                        var result = await _api.CheckInAsync(p);
                        if (result != null && result.Success) ok++;
                        else { fail++; if (result?.Error != null) lastError = result.Error; }
                    }
                    catch (Exception ex) { fail++; lastError = ex.Message; }
                }
                SafeInvoke(() =>
                {
                    if (targets.Count == 1)
                    {
                        if (ok == 1) ShowMessage("Checked in");
                        else ShowMessage(lastError ?? "Check in failed", true);
                    }
                    else
                    {
                        ShowMessage($"Checked in {ok} of {targets.Count} (assembly + children)",
                            fail > 0);
                    }
                });
                UpdateForDocument(_currentFilePath);
            }
            catch (Exception ex) { SafeInvoke(() => ShowMessage(ex.Message, true)); }
            finally { _busy = false; }
        }

        private async System.Threading.Tasks.Task DoSync()
        {
            if (_busy) return;
            _busy = true;
            SetButtonStates(false, false);
            try
            {
                var result = await _api.SyncAsync();
                SafeInvoke(() =>
                {
                    if (result.Success) ShowMessage($"Downloaded ({result.FilesUpdated} updated)");
                    else ShowMessage(result.Error ?? "Download failed", true);
                });
                if (!string.IsNullOrEmpty(_currentFilePath))
                    UpdateForDocument(_currentFilePath);
            }
            catch (Exception ex) { SafeInvoke(() => ShowMessage(ex.Message, true)); }
            finally { _busy = false; }
        }

        private async System.Threading.Tasks.Task DoPublish()
        {
            if (_busy) return;
            using (var dialog = new PublishMessageDialog())
            {
                if (dialog.ShowDialog() != DialogResult.OK) return;
                // Empty message is OK — FrameCAD generates a random 3-word label
                var message = dialog.CommitMessage ?? "";

                _busy = true;
                SetButtonStates(false, false);
                try
                {
                    var result = await _api.PublishAsync(message);
                    SafeInvoke(() =>
                    {
                        if (result.Success) ShowMessage("Uploaded");
                        else ShowMessage(result.Error ?? "Upload failed", true);
                    });
                }
                catch (Exception ex) { SafeInvoke(() => ShowMessage(ex.Message, true)); }
                finally { _busy = false; }
            }
        }

        private async System.Threading.Tasks.Task DoNewPart()
        {
            if (_busy) return;
            using (var dialog = new NewPartDialog())
            {
                if (dialog.ShowDialog() != DialogResult.OK) return;
                _busy = true;
                SetButtonStates(false, false);
                try
                {
                    var desc = string.IsNullOrWhiteSpace(dialog.Description) ? null : dialog.Description;
                    if (dialog.SelectedType == NewItemType.Folder)
                    {
                        var name = dialog.ItemName;
                        if (string.IsNullOrWhiteSpace(name))
                        {
                            ShowMessage("Folder name is required", true);
                            return;
                        }
                        var result = await _api.CreateSubsystemAsync(name);
                        if (result.Success) ShowMessage($"Created {result.FolderPath}");
                        else ShowMessage(result.Error ?? "Failed", true);
                    }
                    else if (dialog.SelectedType == NewItemType.Assembly)
                    {
                        var name = dialog.ItemName;
                        if (string.IsNullOrWhiteSpace(name))
                        {
                            ShowMessage("Assembly name is required", true);
                            return;
                        }
                        var result = await _api.CreateNewAssemblyAsync(name, "", desc);
                        if (!result.Success)
                        {
                            ShowMessage(result.Error ?? "Failed", true);
                        }
                        else
                        {
                            var abs = _api.ToAbsolutePath(result.FilePath);
                            var error = OnCreateSolidWorksFile?.Invoke(abs, true);
                            if (error == null)
                            {
                                if (OnStageFile != null)
                                {
                                    try { await OnStageFile(result.FilePath); } catch { }
                                }
                                UpdateForDocument(abs);
                                ShowMessage($"Created {result.PartNumber}");
                            }
                            else
                            {
                                ShowMessage($"Reserved {result.PartNumber} - {error}", true);
                            }
                        }
                    }
                    else
                    {
                        var result = await _api.CreateNewPartAsync("", desc);
                        if (!result.Success)
                        {
                            ShowMessage(result.Error ?? "Failed", true);
                        }
                        else
                        {
                            var abs = _api.ToAbsolutePath(result.FilePath);
                            var error = OnCreateSolidWorksFile?.Invoke(abs, false);
                            if (error == null)
                            {
                                if (OnStageFile != null)
                                {
                                    try { await OnStageFile(result.FilePath); } catch { }
                                }
                                UpdateForDocument(abs);
                                ShowMessage($"Created {result.PartNumber}");
                            }
                            else
                            {
                                ShowMessage($"Reserved {result.PartNumber} - {error}", true);
                            }
                        }
                    }
                }
                catch (Exception ex) { SafeInvoke(() => ShowMessage(ex.Message, true)); }
                finally { _busy = false; }
            }
        }

        private void DoOpenApp()
        {
            // If FrameCAD is already running, just bring its window to the foreground
            var existing = System.Diagnostics.Process.GetProcessesByName("FrameCAD");
            try
            {
                foreach (var proc in existing)
                {
                    var hwnd = proc.MainWindowHandle;
                    if (hwnd != IntPtr.Zero)
                    {
                        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
                        SetForegroundWindow(hwnd);
                        return;
                    }
                }
            }
            finally
            {
                foreach (var proc in existing) proc.Dispose();
            }

            // Look in every plausible install location. Fresh FrameCAD
            // installs land under "FrameCAD"; v1.0.x TrentCAD installs
            // that were upgraded in place keep their old folder names
            // until the user does a clean re-install.
            var localData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var candidates = new[] {
                System.IO.Path.Combine(localData, "Programs", "framecad", "FrameCAD.exe"),
                System.IO.Path.Combine(localData, "Programs", "FrameCAD", "FrameCAD.exe"),
                System.IO.Path.Combine(localData, "Programs", "trentcad", "FrameCAD.exe"),
                System.IO.Path.Combine(localData, "Programs", "trentcad", "TrentCAD.exe"),
                System.IO.Path.Combine(progFiles, "FrameCAD", "FrameCAD.exe"),
                System.IO.Path.Combine(progFiles, "TrentCAD", "TrentCAD.exe")
            };
            string target = null;
            foreach (var c in candidates) { if (System.IO.File.Exists(c)) { target = c; break; } }

            if (target != null)
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = target, UseShellExecute = true });
            else
                ShowMessage("FrameCAD not found", true);
        }

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        private const int SW_RESTORE = 9;
    }

    internal class StatusDot : Control
    {
        private Color _color = Color.Gray;
        public Color DotColor
        {
            get => _color;
            set { _color = value; Invalidate(); }
        }

        public StatusDot()
        {
            SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.OptimizedDoubleBuffer, true);
            Size = new Size(10, 10);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var brush = new SolidBrush(_color))
                e.Graphics.FillEllipse(brush, 1, 1, Width - 2, Height - 2);
        }
    }
}
