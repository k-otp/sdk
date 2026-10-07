"""Extract a Go module ZIP while enforcing its exact canonical prefix."""
import pathlib
import stat
import sys
import zipfile

archive, destination, module, version = sys.argv[1:]
root = pathlib.Path(destination)
prefix = f"{module}@v{version}/"
with zipfile.ZipFile(archive) as source:
    for item in source.infolist():
        if not item.filename.startswith(prefix):
            raise ValueError("Wrong Go module ZIP prefix")
        relative = item.filename[len(prefix):]
        path = pathlib.PurePosixPath(relative)
        if (not relative or path.is_absolute() or ".." in path.parts
                or "\\" in relative or stat.S_ISLNK(item.external_attr >> 16)
                or item.is_dir()):
            raise ValueError("Unsafe Go module ZIP entry")
        output = root / path
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(source.read(item))
