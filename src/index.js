export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      try {
        const formData = await request.formData();
        const file = formData.get("file");
        if (!file) {
          return new Response("No file uploaded", { status: 400 });
        }

        // 调用 CloudConvert API
        const apiKey = env.CLOUDCONVERT_API_KEY;
        if (!apiKey) {
          return new Response("Missing CLOUDCONVERT_API_KEY", { status: 500 });
        }

        const uploadResp = await fetch("https://api.cloudconvert.com/v2/import/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const uploadData = await uploadResp.json();
        const uploadUrl = uploadData.data.result.form.url;

        // 上传文件到 CloudConvert
        await fetch(uploadUrl, {
          method: "POST",
          body: (() => {
            const form = new FormData();
            form.append("file", file);
            return form;
          })()
        });

        // 创建转换任务
        const convertResp = await fetch("https://api.cloudconvert.com/v2/jobs", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            tasks: {
              "import-my-file": { operation: "import/upload" },
              "convert-my-file": {
                operation: "convert",
                input: ["import-my-file"],
                output_format: "docx"
              },
              "export-my-file": { operation: "export/url", input: ["convert-my-file"] }
            }
          })
        });
        const convertData = await convertResp.json();
        const jobId = convertData.data.id;

        // 轮询结果
        let downloadUrl = null;
        for (let i = 0; i < 10; i++) {
          const statusResp = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
            headers: { Authorization: `Bearer ${apiKey}` }
          });
          const statusData = await statusResp.json();
          const exportTask = statusData.data.tasks.find(t => t.name === "export-my-file" && t.result);
          if (exportTask && exportTask.result && exportTask.result.files.length > 0) {
            downloadUrl = exportTask.result.files[0].url;
            break;
          }
          await new Promise(r => setTimeout(r, 2000));
        }

        if (!downloadUrl) {
          return new Response("转换超时", { status: 500 });
        }

        const docxResp = await fetch(downloadUrl);
        const blob = await docxResp.blob();
        return new Response(blob, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition": "attachment; filename=converted.docx"
          }
        });
      } catch (err) {
        return new Response("转换失败: " + err.message, { status: 500 });
      }
    }
    return new Response("PDF2Word Worker is running.");
  }
}