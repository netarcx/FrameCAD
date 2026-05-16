using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using Newtonsoft.Json;
using System.Threading.Tasks;
using FrameCAD.SolidWorksAddin.Models;

namespace FrameCAD.SolidWorksAddin
{
    public class FrameCadApiClient
    {
        private static readonly HttpClient Client = new HttpClient(
            new HttpClientHandler { UseProxy = false, Proxy = null, UseDefaultCredentials = false })
        {
            Timeout = TimeSpan.FromSeconds(10)
        };

        private readonly string _baseUrl;
        private string _projectRoot;

        public FrameCadApiClient(int port = 42129)
        {
            _baseUrl = $"http://127.0.0.1:{port}";
        }

        public string ToRelativePath(string absolutePath)
        {
            if (string.IsNullOrEmpty(_projectRoot) || string.IsNullOrEmpty(absolutePath))
                return absolutePath;

            var normalized = absolutePath.Replace("\\", "/");
            var root = _projectRoot.Replace("\\", "/").TrimEnd('/') + "/";

            if (normalized.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                return normalized.Substring(root.Length);

            return absolutePath;
        }

        public string ToAbsolutePath(string relativePath)
        {
            if (string.IsNullOrEmpty(_projectRoot) || string.IsNullOrEmpty(relativePath))
                return relativePath;
            return System.IO.Path.Combine(
                _projectRoot,
                relativePath.Replace("/", System.IO.Path.DirectorySeparatorChar.ToString()));
        }

        public async Task<HealthResponse> GetHealthAsync()
        {
            var response = await Client.GetAsync($"{_baseUrl}/api/health");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            var health = JsonConvert.DeserializeObject<HealthResponse>(json);

            if (health?.Project?.Path != null)
                _projectRoot = health.Project.Path;

            return health;
        }

        public async Task<bool> IsConnectedAsync()
        {
            try
            {
                var health = await GetHealthAsync();
                return health?.Running == true;
            }
            catch
            {
                return false;
            }
        }

        public async Task<FileStatus> GetFileAsync(string absolutePath)
        {
            var relativePath = ToRelativePath(absolutePath);
            var encoded = Uri.EscapeDataString(relativePath);
            var response = await Client.GetAsync($"{_baseUrl}/api/file?path={encoded}");

            if (!response.IsSuccessStatusCode)
                return null;

            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<FileStatus>(json);
        }

        public async Task<ApiResult> CheckOutAsync(string absolutePath)
        {
            var relativePath = ToRelativePath(absolutePath);
            var body = JsonConvert.SerializeObject(new { path = relativePath });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/checkout", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<ApiResult>(json);
        }

        public async Task<ApiResult> CheckInAsync(string absolutePath)
        {
            var relativePath = ToRelativePath(absolutePath);
            var body = JsonConvert.SerializeObject(new { path = relativePath });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/checkin", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<ApiResult>(json);
        }

        /// <summary>
        /// Tell FrameCAD to `git add` a newly-created file so it's tracked
        /// before the user's first publish. Best-effort — caller swallows
        /// errors because the file will still surface as "untracked" in
        /// the next status refresh. Uses the shared static HttpClient
        /// (reuses sockets) instead of constructing a per-call client.
        /// </summary>
        public async Task<ApiResult> StageAsync(string relativePath)
        {
            var body = JsonConvert.SerializeObject(new { path = relativePath });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/stage", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<ApiResult>(json);
        }

        public async Task<SyncResult> SyncAsync()
        {
            var response = await Client.PostAsync($"{_baseUrl}/api/sync", new StringContent("{}", Encoding.UTF8, "application/json"));
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<SyncResult>(json);
        }

        public async Task<PublishResult> PublishAsync(string message)
        {
            var body = JsonConvert.SerializeObject(new { message });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/publish", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<PublishResult>(json);
        }

        public async Task<CreatePartResult> CreateNewPartAsync(string folder = "", string description = null)
        {
            var obj = new Dictionary<string, string> { { "folder", folder } };
            if (description != null) obj["description"] = description;
            var body = JsonConvert.SerializeObject(obj);
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/parts/new-part", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<CreatePartResult>(json);
        }

        public async Task<CreatePartResult> CreateNewAssemblyAsync(string name, string parentFolder = "", string description = null)
        {
            var obj = new Dictionary<string, string> { { "name", name }, { "parentFolder", parentFolder } };
            if (description != null) obj["description"] = description;
            var body = JsonConvert.SerializeObject(obj);
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/parts/new-assembly", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<CreatePartResult>(json);
        }

        public async Task<CreateSubsystemResult> CreateSubsystemAsync(string name, string parentFolder = "")
        {
            var obj = new Dictionary<string, string> { { "name", name }, { "parentFolder", parentFolder } };
            var body = JsonConvert.SerializeObject(obj);
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/parts/new-subsystem", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<CreateSubsystemResult>(json);
        }

        public async Task<List<PendingCreate>> GetPendingCreatesAsync()
        {
            var response = await Client.GetAsync($"{_baseUrl}/api/pending-creates");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<List<PendingCreate>>(json);
        }

        public async Task MarkPendingDoneAsync(string id)
        {
            var body = JsonConvert.SerializeObject(new { id });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            await Client.PostAsync($"{_baseUrl}/api/pending-creates/done", content);
        }

        public async Task<List<PendingExport>> GetPendingExportsAsync()
        {
            var response = await Client.GetAsync($"{_baseUrl}/api/pending-exports");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<List<PendingExport>>(json);
        }

        public async Task MarkExportDoneAsync(string id, string error = null)
        {
            var payload = error == null
                ? (object)new { id }
                : new { id, error };
            var body = JsonConvert.SerializeObject(payload);
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            await Client.PostAsync($"{_baseUrl}/api/pending-exports/done", content);
        }

        public async Task<List<LockInfo>> GetLocksAsync()
        {
            var response = await Client.GetAsync($"{_baseUrl}/api/locks");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<List<LockInfo>>(json);
        }

        /// <summary>
        /// Bring the FrameCAD main window to the foreground.
        /// </summary>
        public async Task<ApiResult> FocusFrameCadAsync()
        {
            try
            {
                var response = await Client.PostAsync($"{_baseUrl}/api/focus",
                    new StringContent("{}", Encoding.UTF8, "application/json"));
                var json = await response.Content.ReadAsStringAsync();
                return JsonConvert.DeserializeObject<ApiResult>(json) ?? new ApiResult { Success = false, Error = "Empty response" };
            }
            catch (Exception ex)
            {
                return new ApiResult { Success = false, Error = ex.Message };
            }
        }

        /// <summary>
        /// Fetch the per-part metadata blob (release state, comments, mass, cost, etc.)
        /// for the file at the given absolute path. Returns null if no metadata exists.
        /// </summary>
        public async Task<PartMetaDto> GetPartMetaAsync(string absolutePath)
        {
            var relativePath = ToRelativePath(absolutePath);
            var encoded = Uri.EscapeDataString(relativePath);
            try
            {
                var response = await Client.GetAsync($"{_baseUrl}/api/meta?path={encoded}");
                if (!response.IsSuccessStatusCode) return null;
                var json = await response.Content.ReadAsStringAsync();
                return JsonConvert.DeserializeObject<PartMetaDto>(json);
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Set the part's release state (draft / in-review / released / manufactured).
        /// </summary>
        public async Task<ApiResult> SetReleaseStateAsync(string absolutePath, string state)
        {
            var relativePath = ToRelativePath(absolutePath);
            var body = JsonConvert.SerializeObject(new { path = relativePath, state });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            try
            {
                var response = await Client.PostAsync($"{_baseUrl}/api/release-state", content);
                var json = await response.Content.ReadAsStringAsync();
                return JsonConvert.DeserializeObject<ApiResult>(json) ?? new ApiResult { Success = false, Error = "Empty response" };
            }
            catch (Exception ex)
            {
                return new ApiResult { Success = false, Error = ex.Message };
            }
        }

        /// <summary>
        /// Fetch the bundle of values to fill into a drawing's title
        /// block (part number, description, material, mass, designer,
        /// date). Returns null on any failure.
        /// </summary>
        public async Task<TitleBlockDataDto> GetTitleBlockDataAsync(string absolutePath)
        {
            var relativePath = ToRelativePath(absolutePath);
            var encoded = Uri.EscapeDataString(relativePath);
            try
            {
                var response = await Client.GetAsync($"{_baseUrl}/api/title-block-data?path={encoded}");
                if (!response.IsSuccessStatusCode) return null;
                var json = await response.Content.ReadAsStringAsync();
                return JsonConvert.DeserializeObject<TitleBlockDataDto>(json);
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Push a SolidWorks-computed mass (in pounds) for the given file.
        /// Used by the SW add-in's FileSavePostNotify hook so the user
        /// doesn't have to manually type mass into FrameCAD every save.
        /// </summary>
        public async Task<ApiResult> SetPartMassAutoAsync(string absolutePath, double massPounds)
        {
            var relativePath = ToRelativePath(absolutePath);
            var body = JsonConvert.SerializeObject(new { path = relativePath, mass = massPounds });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            try
            {
                var response = await Client.PostAsync($"{_baseUrl}/api/part-mass-auto", content);
                var json = await response.Content.ReadAsStringAsync();
                return JsonConvert.DeserializeObject<ApiResult>(json) ?? new ApiResult { Success = false, Error = "Empty response" };
            }
            catch (Exception ex)
            {
                return new ApiResult { Success = false, Error = ex.Message };
            }
        }

        /// <summary>
        /// Set the part's manufacturing material in FrameCAD metadata.
        /// </summary>
        public async Task<ApiResult> SetManufacturingMaterialAsync(string absolutePath, string material)
        {
            var relativePath = ToRelativePath(absolutePath);
            var body = JsonConvert.SerializeObject(new { path = relativePath, material });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            try
            {
                var response = await Client.PostAsync($"{_baseUrl}/api/material", content);
                var json = await response.Content.ReadAsStringAsync();
                return JsonConvert.DeserializeObject<ApiResult>(json) ?? new ApiResult { Success = false, Error = "Empty response" };
            }
            catch (Exception ex)
            {
                return new ApiResult { Success = false, Error = ex.Message };
            }
        }

        /// <summary>
        /// Set the part's manufacturing method (print/cnc/manual/other).
        /// Pass null or empty to clear. Required so released parts show up
        /// on the correct tab of FrameCAD's manufacturing queue.
        /// </summary>
        public async Task<ApiResult> SetManufacturingMethodAsync(string absolutePath, string method)
        {
            var relativePath = ToRelativePath(absolutePath);
            // method = null sends `{ path, method: null }` so the server
            // clears the field. JsonConvert serializes null literally.
            var body = JsonConvert.SerializeObject(new { path = relativePath, method });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            try
            {
                var response = await Client.PostAsync($"{_baseUrl}/api/manufacturing-method", content);
                var json = await response.Content.ReadAsStringAsync();
                return JsonConvert.DeserializeObject<ApiResult>(json) ?? new ApiResult { Success = false, Error = "Empty response" };
            }
            catch (Exception ex)
            {
                return new ApiResult { Success = false, Error = ex.Message };
            }
        }

        /// <summary>
        /// Append a comment to the part's metadata. Author is resolved server-side
        /// from `git config user.name`.
        /// </summary>
        public async Task<ApiResult> AddCommentAsync(string absolutePath, string text)
        {
            var relativePath = ToRelativePath(absolutePath);
            var body = JsonConvert.SerializeObject(new { path = relativePath, text });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            try
            {
                var response = await Client.PostAsync($"{_baseUrl}/api/comments", content);
                var json = await response.Content.ReadAsStringAsync();
                return JsonConvert.DeserializeObject<ApiResult>(json) ?? new ApiResult { Success = false, Error = "Empty response" };
            }
            catch (Exception ex)
            {
                return new ApiResult { Success = false, Error = ex.Message };
            }
        }
    }
}
