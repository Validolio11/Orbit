// Embeds the Orbit icon and version into Orbit.exe on Windows.
fn main() {
    #[cfg(windows)]
    {
        let mut resource = winresource::WindowsResource::new();
        resource
            .set_icon("assets/orbit.ico")
            .set("ProductName", "Orbit")
            .set("FileDescription", "Orbit");
        if let Err(error) = resource.compile() {
            println!("cargo:warning=Orbit icon was not embedded: {error}");
        }
    }
    println!("cargo:rerun-if-changed=assets/orbit.ico");
}
