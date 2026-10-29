fn main() {
    uniffi::generate_scaffolding("src/zcash.udl").expect("the UDL parses");
}
