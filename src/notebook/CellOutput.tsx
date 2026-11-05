export function CellOutput({ mimetype, data }: { mimetype: string; data: string }) {
  if (mimetype === "text/html")
    return (
      <iframe
        title="Cell output"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${data}`}
      />
    );
  if (["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(mimetype)) {
    const source =
      mimetype === "image/svg+xml"
        ? `data:image/svg+xml,${encodeURIComponent(data)}`
        : `data:${mimetype};base64,${data}`;
    return <img className="output-image" src={source} alt="Cell output" />;
  }
  return <pre>{data}</pre>;
}
