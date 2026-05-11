using Newtonsoft.Json;

namespace TrentCAD.SolidWorksAddin.Models
{
    public class HealthResponse
    {
        [JsonProperty("running")]
        public bool Running { get; set; }

        [JsonProperty("project")]
        public ProjectInfo Project { get; set; }
    }

    public class ProjectInfo
    {
        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("path")]
        public string Path { get; set; }

        [JsonProperty("remote")]
        public string Remote { get; set; }
    }

    public class ApiResult
    {
        [JsonProperty("success")]
        public bool Success { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; }
    }

    public class SyncResult
    {
        [JsonProperty("success")]
        public bool Success { get; set; }

        [JsonProperty("filesUpdated")]
        public int FilesUpdated { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; }
    }

    public class PublishResult
    {
        [JsonProperty("success")]
        public bool Success { get; set; }

        [JsonProperty("hash")]
        public string Hash { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; }
    }

    public class CreatePartResult
    {
        [JsonProperty("success")]
        public bool Success { get; set; }

        [JsonProperty("partNumber")]
        public string PartNumber { get; set; }

        [JsonProperty("filePath")]
        public string FilePath { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; }
    }

    public class CreateSubsystemResult
    {
        [JsonProperty("success")]
        public bool Success { get; set; }

        [JsonProperty("folderPath")]
        public string FolderPath { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; }
    }

    public class PendingCreate
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("type")]
        public string Type { get; set; }

        [JsonProperty("relativePath")]
        public string RelativePath { get; set; }

        [JsonProperty("absolutePath")]
        public string AbsolutePath { get; set; }

        [JsonProperty("partNumber")]
        public string PartNumber { get; set; }
    }

    public class LockInfo
    {
        [JsonProperty("path")]
        public string Path { get; set; }

        [JsonProperty("owner")]
        public string Owner { get; set; }

        [JsonProperty("id")]
        public string Id { get; set; }
    }
}
