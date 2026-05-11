using System;
using System.Drawing;
using System.Drawing.Drawing2D;
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
        private const int BtnHeight = 32;
        private const int BtnGap = 4;
        private const int SectionGap = 16;

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
            var title = new Label
            {
                Text = $"TrentCAD v{version.Major}.{version.Minor}.{version.Build}",
                Font = new Font("Segoe UI Semibold", 13f),
                ForeColor = CText,
                Location = new Point(Pad, 10),
                AutoSize = true
            };
            Controls.Add(title);

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
                AutoSize = true
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

            _btnSync = MakeButton("Sync");
            _btnSync.Click += async (s, e) => await DoSync();
            Controls.Add(_btnSync);

            _btnPublish = MakeButton("Publish");
            _btnPublish.Click += async (s, e) => await DoPublish();
            Controls.Add(_btnPublish);

            _btnNewPart = MakeButton("New Part / Assembly");
            _btnNewPart.Click += async (s, e) => await DoNewPart();
            Controls.Add(_btnNewPart);

            _btnOpenApp = MakeButton("Open TrentCAD");
            _btnOpenApp.BackColor = CBlue;
            _btnOpenApp.ForeColor = CMantle;
            _btnOpenApp.Font = new Font("Segoe UI Semibold", 9f);
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
            var y = 34;

            _pnlConnection.Location = new Point(Pad, y);
            _pnlConnection.Width = w;
            y += 26;

            if (_pnlFileCard.Visible)
            {
                _pnlFileCard.Location = new Point(Pad, y);
                _pnlFileCard.Width = w;

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
            var lbl = new Label
            {
                ForeColor = color,
                Font = font,
                Location = new Point(10, y),
                AutoSize = true
            };
            parent.Controls.Add(lbl);
            y += (int)(font.GetHeight() + 6);
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
                Font = new Font("Segoe UI", 9f),
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

        private void SetButtonStates(bool canCheckOut, bool canCheckIn)
        {
            _btnCheckOut.Enabled = _connected && canCheckOut && !_busy;
            _btnCheckIn.Enabled = _connected && canCheckIn && !_busy;
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

            SafeInvoke(() =>
            {
                if (error != null)
                {
                    _connected = false;
                    _dot.DotColor = CRed;
                    var msg = error.InnerException?.Message ?? error.Message;
                    if (msg.Length > 60) msg = msg.Substring(0, 57) + "...";
                    _lblConnection.Text = "Conn error: " + msg;
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
                    SetButtonStates(false, false);
                    if (!wasConnected && !string.IsNullOrEmpty(_currentFilePath))
                        UpdateForDocument(_currentFilePath);
                }
                else if (isConnected)
                {
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
                    statusText = "Synced";
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

        private async System.Threading.Tasks.Task DoCheckOut()
        {
            if (string.IsNullOrEmpty(_currentFilePath) || _busy) return;
            _busy = true;
            SetButtonStates(false, false);
            try
            {
                var result = await _api.CheckOutAsync(_currentFilePath);
                SafeInvoke(() =>
                {
                    if (result.Success) ShowMessage("Checked out");
                    else ShowMessage(result.Error ?? "Check out failed", true);
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
                var result = await _api.CheckInAsync(_currentFilePath);
                SafeInvoke(() =>
                {
                    if (result.Success) ShowMessage("Checked in");
                    else ShowMessage(result.Error ?? "Check in failed", true);
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
                    if (result.Success) ShowMessage($"Synced ({result.FilesUpdated} updated)");
                    else ShowMessage(result.Error ?? "Sync failed", true);
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
                var message = dialog.CommitMessage;
                if (string.IsNullOrWhiteSpace(message)) return;

                _busy = true;
                SetButtonStates(false, false);
                try
                {
                    var result = await _api.PublishAsync(message);
                    SafeInvoke(() =>
                    {
                        if (result.Success) ShowMessage("Published");
                        else ShowMessage(result.Error ?? "Publish failed", true);
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
                        SafeInvoke(() =>
                        {
                            if (result.Success) ShowMessage($"Created {result.FolderPath}");
                            else ShowMessage(result.Error ?? "Failed", true);
                        });
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
                        SafeInvoke(() =>
                        {
                            if (result.Success) ShowMessage($"Created {result.PartNumber}");
                            else ShowMessage(result.Error ?? "Failed", true);
                        });
                    }
                    else
                    {
                        var result = await _api.CreateNewPartAsync("", desc);
                        SafeInvoke(() =>
                        {
                            if (result.Success) ShowMessage($"Created {result.PartNumber}");
                            else ShowMessage(result.Error ?? "Failed", true);
                        });
                    }
                }
                catch (Exception ex) { SafeInvoke(() => ShowMessage(ex.Message, true)); }
                finally { _busy = false; }
            }
        }

        private void DoOpenApp()
        {
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
