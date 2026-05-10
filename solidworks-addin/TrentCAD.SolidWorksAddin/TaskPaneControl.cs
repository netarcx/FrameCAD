using System;
using System.Drawing;
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

        private Label _lblTitle;
        private Label _lblConnection;
        private Panel _pnlConnection;

        private GroupBox _grpFile;
        private Label _lblFileName;
        private Label _lblPartNumber;
        private Label _lblStatus;
        private Label _lblLockedBy;
        private Label _lblDescription;

        private Button _btnCheckOut;
        private Button _btnCheckIn;
        private Button _btnSync;
        private Button _btnPublish;

        private Label _lblMessage;

        public TaskPaneControl()
        {
            InitializeControls();
        }

        private void InitializeControls()
        {
            BackColor = Color.FromArgb(30, 30, 46);
            AutoScroll = true;
            Padding = new Padding(12);

            var y = 12;

            _lblTitle = new Label
            {
                Text = "TrentCAD",
                Font = new Font("Segoe UI", 14f, FontStyle.Bold),
                ForeColor = Color.FromArgb(137, 180, 250),
                Location = new Point(12, y),
                AutoSize = true
            };
            Controls.Add(_lblTitle);
            y += 36;

            _pnlConnection = new Panel
            {
                Location = new Point(12, y),
                Size = new Size(220, 24),
                Anchor = AnchorStyles.Left | AnchorStyles.Top | AnchorStyles.Right
            };
            var dot = new Panel
            {
                Size = new Size(8, 8),
                Location = new Point(0, 8),
                BackColor = Color.Gray
            };
            dot.Name = "connectionDot";
            _pnlConnection.Controls.Add(dot);
            _lblConnection = new Label
            {
                Text = "Checking...",
                ForeColor = Color.FromArgb(166, 173, 200),
                Font = new Font("Segoe UI", 9f),
                Location = new Point(14, 3),
                AutoSize = true
            };
            _pnlConnection.Controls.Add(_lblConnection);
            Controls.Add(_pnlConnection);
            y += 34;

            _grpFile = new GroupBox
            {
                Text = "Current File",
                ForeColor = Color.FromArgb(166, 173, 200),
                Font = new Font("Segoe UI", 9f),
                Location = new Point(12, y),
                Size = new Size(220, 160),
                Visible = false,
                Anchor = AnchorStyles.Left | AnchorStyles.Top | AnchorStyles.Right
            };

            var fy = 20;
            _lblFileName = CreateInfoLabel(_grpFile, ref fy, "");
            _lblFileName.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            _lblFileName.ForeColor = Color.FromArgb(205, 214, 244);

            _lblPartNumber = CreateInfoLabel(_grpFile, ref fy, "");
            _lblPartNumber.Font = new Font("Consolas", 10f, FontStyle.Bold);
            _lblPartNumber.ForeColor = Color.FromArgb(137, 180, 250);

            _lblDescription = CreateInfoLabel(_grpFile, ref fy, "");
            _lblDescription.ForeColor = Color.FromArgb(166, 173, 200);

            _lblStatus = CreateInfoLabel(_grpFile, ref fy, "");
            _lblLockedBy = CreateInfoLabel(_grpFile, ref fy, "");

            Controls.Add(_grpFile);
            y += 170;

            _btnCheckOut = CreateButton("Check Out", y);
            _btnCheckOut.Click += async (s, e) => await DoCheckOut();
            Controls.Add(_btnCheckOut);
            y += 34;

            _btnCheckIn = CreateButton("Check In", y);
            _btnCheckIn.Click += async (s, e) => await DoCheckIn();
            Controls.Add(_btnCheckIn);
            y += 44;

            _btnSync = CreateButton("Sync", y);
            _btnSync.Click += async (s, e) => await DoSync();
            Controls.Add(_btnSync);
            y += 34;

            _btnPublish = CreateButton("Publish", y);
            _btnPublish.Click += async (s, e) => await DoPublish();
            Controls.Add(_btnPublish);
            y += 44;

            _lblMessage = new Label
            {
                Text = "",
                ForeColor = Color.FromArgb(166, 173, 200),
                Font = new Font("Segoe UI", 8f),
                Location = new Point(12, y),
                Size = new Size(220, 40),
                AutoSize = false,
                Anchor = AnchorStyles.Left | AnchorStyles.Top | AnchorStyles.Right
            };
            Controls.Add(_lblMessage);

            SetButtonStates(false, false);
        }

        private Label CreateInfoLabel(Control parent, ref int y, string text)
        {
            var lbl = new Label
            {
                Text = text,
                ForeColor = Color.FromArgb(166, 173, 200),
                Font = new Font("Segoe UI", 9f),
                Location = new Point(8, y),
                AutoSize = true
            };
            parent.Controls.Add(lbl);
            y += 22;
            return lbl;
        }

        private Button CreateButton(string text, int y)
        {
            return new Button
            {
                Text = text,
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(49, 50, 68),
                ForeColor = Color.FromArgb(205, 214, 244),
                Font = new Font("Segoe UI", 9f),
                Location = new Point(12, y),
                Size = new Size(220, 28),
                Anchor = AnchorStyles.Left | AnchorStyles.Top | AnchorStyles.Right,
                FlatAppearance =
                {
                    BorderColor = Color.FromArgb(69, 71, 90),
                    MouseOverBackColor = Color.FromArgb(69, 71, 90)
                },
                Enabled = false
            };
        }

        private void SafeInvoke(Action action)
        {
            if (_disposed || IsDisposed || !IsHandleCreated) return;
            try { BeginInvoke(action); } catch (ObjectDisposedException) { }
        }

        private void SetButtonStates(bool canCheckOut, bool canCheckIn)
        {
            _btnCheckOut.Enabled = canCheckOut && !_busy;
            _btnCheckIn.Enabled = canCheckIn && !_busy;
            _btnSync.Enabled = !_busy;
            _btnPublish.Enabled = !_busy;
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
            try
            {
                var connected = await _api.IsConnectedAsync();
                SafeInvoke(() =>
                {
                    var dot = _pnlConnection.Controls["connectionDot"];
                    if (connected)
                    {
                        dot.BackColor = Color.FromArgb(166, 227, 161);
                        _lblConnection.Text = "Connected";
                        _btnSync.Enabled = !_busy;
                        _btnPublish.Enabled = !_busy;
                    }
                    else
                    {
                        dot.BackColor = Color.FromArgb(243, 139, 168);
                        _lblConnection.Text = "TrentCAD Not Running";
                        SetButtonStates(false, false);
                    }
                });
            }
            catch
            {
                // Ignore polling errors
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
                    _grpFile.Visible = true;
                    _lblFileName.Text = System.IO.Path.GetFileName(absolutePath);
                    _lblPartNumber.Text = "";
                    _lblDescription.Text = "";
                    _lblStatus.Text = "Not in project";
                    _lblLockedBy.Text = "";
                    SetButtonStates(false, false);
                });
            }
        }

        public void ClearDocument()
        {
            _currentFilePath = null;
            _grpFile.Visible = false;
            SetButtonStates(false, false);
        }

        private void UpdateFileDisplay(FileStatus file, string path)
        {
            _grpFile.Visible = true;

            if (file == null)
            {
                _lblFileName.Text = System.IO.Path.GetFileName(path);
                _lblPartNumber.Text = "";
                _lblDescription.Text = "";
                _lblStatus.Text = "Not in project";
                _lblLockedBy.Text = "";
                SetButtonStates(false, false);
                return;
            }

            _lblFileName.Text = file.Name;
            _lblPartNumber.Text = file.PartNumber ?? "";
            _lblDescription.Text = file.PartDescription ?? "";

            switch (file.State)
            {
                case "synced":
                    _lblStatus.Text = "Status: Synced";
                    _lblStatus.ForeColor = Color.FromArgb(166, 227, 161);
                    break;
                case "modified":
                    _lblStatus.Text = "Status: Modified";
                    _lblStatus.ForeColor = Color.FromArgb(249, 226, 175);
                    break;
                case "untracked":
                    _lblStatus.Text = "Status: New";
                    _lblStatus.ForeColor = Color.FromArgb(108, 112, 134);
                    break;
                case "locked-by-you":
                    _lblStatus.Text = "Status: Checked Out by You";
                    _lblStatus.ForeColor = Color.FromArgb(137, 180, 250);
                    break;
                case "locked-by-other":
                    _lblStatus.Text = "Status: Locked";
                    _lblStatus.ForeColor = Color.FromArgb(243, 139, 168);
                    break;
                default:
                    _lblStatus.Text = $"Status: {file.State}";
                    _lblStatus.ForeColor = Color.FromArgb(166, 173, 200);
                    break;
            }

            _lblLockedBy.Text = !string.IsNullOrEmpty(file.LockedBy) ? $"Locked by: {file.LockedBy}" : "";

            var canCheckOut = file.State != "locked-by-you" && file.State != "locked-by-other";
            var canCheckIn = file.State == "locked-by-you";
            SetButtonStates(canCheckOut, canCheckIn);
        }

        private void ShowMessage(string text, bool isError = false)
        {
            _lblMessage.Text = text;
            _lblMessage.ForeColor = isError
                ? Color.FromArgb(243, 139, 168)
                : Color.FromArgb(166, 227, 161);
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
                    if (result.Success)
                        ShowMessage("Checked out successfully");
                    else
                        ShowMessage(result.Error ?? "Check out failed", true);
                });
                UpdateForDocument(_currentFilePath);
            }
            catch (Exception ex)
            {
                SafeInvoke(() => ShowMessage(ex.Message, true));
            }
            finally
            {
                _busy = false;
            }
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
                    if (result.Success)
                        ShowMessage("Checked in successfully");
                    else
                        ShowMessage(result.Error ?? "Check in failed", true);
                });
                UpdateForDocument(_currentFilePath);
            }
            catch (Exception ex)
            {
                SafeInvoke(() => ShowMessage(ex.Message, true));
            }
            finally
            {
                _busy = false;
            }
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
                    if (result.Success)
                        ShowMessage($"Synced ({result.FilesUpdated} files updated)");
                    else
                        ShowMessage(result.Error ?? "Sync failed", true);
                });
                if (!string.IsNullOrEmpty(_currentFilePath))
                    UpdateForDocument(_currentFilePath);
            }
            catch (Exception ex)
            {
                SafeInvoke(() => ShowMessage(ex.Message, true));
            }
            finally
            {
                _busy = false;
            }
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
                        if (result.Success)
                            ShowMessage("Published successfully");
                        else
                            ShowMessage(result.Error ?? "Publish failed", true);
                    });
                }
                catch (Exception ex)
                {
                    SafeInvoke(() => ShowMessage(ex.Message, true));
                }
                finally
                {
                    _busy = false;
                }
            }
        }
    }
}
