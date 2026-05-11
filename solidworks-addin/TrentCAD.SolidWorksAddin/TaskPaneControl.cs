using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using TrentCAD.SolidWorksAddin.Models;

namespace TrentCAD.SolidWorksAddin
{
    public class TaskPaneControl : UserControl
    {
        private readonly TrentCadApiClient _api = new TrentCadApiClient();
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

        private Button _btnCheckOut, _btnCheckIn;
        private Button _btnSync, _btnPublish;
        private Button _btnNewPart;
        private Button _btnOpenApp;
        private Label _lblMessage;

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
                Text = $"TrentCAD v{version.Major}.{version.Minor}.{version.Build}",
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

            _btnOpenApp = MakeButton("Open TrentCAD");
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

            SetButtonStates(false, false);
            LayoutAll();
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

            PlaceButton(_btnCheckOut, ref y, w);
            PlaceButton(_btnCheckIn, ref y, w);
            y += SectionGap - BtnGap;

            PlaceButton(_btnSync, ref y, w);
            PlaceButton(_btnPublish, ref y, w);
            y += SectionGap - BtnGap;

            PlaceButton(_btnNewPart, ref y, w);
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
                        label = "TrentCAD desktop app is not open";
                    }
                    else if (error is System.Threading.Tasks.TaskCanceledException)
                    {
                        label = "TrentCAD not responding";
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

            try
            {
                var file = await _api.GetFileAsync(absolutePath);
                if (_currentFilePath != absolutePath) return;
                SafeInvoke(() => UpdateFileDisplay(file, absolutePath));
            }
            catch
            {
                if (_currentFilePath != absolutePath) return;
                SafeInvoke(() =>
                {
                    ShowFileCard(System.IO.Path.GetFileName(absolutePath), "", "", "Not tracked", COverlay0, "");
                    SetButtonStates(false, false);
                });
            }
        }

        public void ClearDocument()
        {
            _currentFilePath = null;
            _pnlFileCard.Visible = false;
            SetButtonStates(false, false);
            LayoutAll();
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
                // Empty message is OK — TrentCAD generates a random 3-word label
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
            // If TrentCAD is already running, just bring its window to the foreground
            var existing = System.Diagnostics.Process.GetProcessesByName("TrentCAD");
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

            var localApp = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "trentcad", "TrentCAD.exe");
            var progFiles = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "TrentCAD", "TrentCAD.exe");

            var target = System.IO.File.Exists(localApp) ? localApp
                       : System.IO.File.Exists(progFiles) ? progFiles
                       : null;

            if (target != null)
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = target, UseShellExecute = true });
            else
                ShowMessage("TrentCAD not found", true);
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
