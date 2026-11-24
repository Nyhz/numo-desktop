// Evita la ventana de consola en Windows en versiones de publicación.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    caudal_lib::run();
}
