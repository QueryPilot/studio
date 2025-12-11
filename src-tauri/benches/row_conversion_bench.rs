use criterion::{black_box, criterion_group, criterion_main, Criterion};
use rayon::prelude::*;

fn sequential_process(rows: usize) -> Vec<Vec<i32>> {
    (0..rows)
        .map(|i| vec![i as i32; 10])
        .collect()
}

fn parallel_process(rows: usize) -> Vec<Vec<i32>> {
    (0..rows)
        .into_par_iter()
        .map(|i| vec![i as i32; 10])
        .collect()
}

fn benchmark_conversion(c: &mut Criterion) {
    c.bench_function("sequential 500 rows", |b| {
        b.iter(|| sequential_process(black_box(500)))
    });

    c.bench_function("parallel 500 rows", |b| {
        b.iter(|| parallel_process(black_box(500)))
    });

    c.bench_function("sequential 5000 rows", |b| {
        b.iter(|| sequential_process(black_box(5000)))
    });

    c.bench_function("parallel 5000 rows", |b| {
        b.iter(|| parallel_process(black_box(5000)))
    });
}

criterion_group!(benches, benchmark_conversion);
criterion_main!(benches);
