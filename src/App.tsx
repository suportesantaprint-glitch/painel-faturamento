import React, { FormEvent, useEffect, useMemo, useState } from "react";
import "./App.css";
import { supabase } from "./supabase";

type Faturamento = {
  id: number;
  descricao: string;
  valor: number;
  data: string;
  criadoEm: string;
};

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dataAtual = new Date().toISOString().slice(0, 10);

function App() {
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(dataAtual);
  const [faturamentos, setFaturamentos] = useState<Faturamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const total = useMemo(
    () => faturamentos.reduce((acc, item) => acc + Number(item.valor), 0),
    [faturamentos]
  );

  async function carregarFaturamentos() {
    try {
      setCarregando(true);
      setErro("");

      const { data, error } = await supabase
        .from("faturamentos")
        .select("*")
        .order("id", { ascending: false });

      if (error) throw error;

      setFaturamentos((data as Faturamento[]) || []);
    } catch (err: any) {
      setErro(err.message || "Erro ao carregar dados.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarFaturamentos();
  }, []);

  async function salvarFaturamento(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const valorNumerico = Number(valor);

    if (!descricao.trim() || !Number.isFinite(valorNumerico) || valorNumerico < 0) {
      setErro("Preencha descrição e valor válido.");
      return;
    }

    try {
      setSalvando(true);
      setErro("");

      const { data: novoItem, error } = await supabase
        .from("faturamentos")
        .insert([
          {
            descricao: descricao.trim(),
            valor: valorNumerico,
            data,
          },
        ])
        .select()
        .single();

      if (error) throw error;

      setFaturamentos((atual) => [
        novoItem as Faturamento,
        ...atual,
      ]);

      setDescricao("");
      setValor("");
      setData(dataAtual);
    } catch (err: any) {
      setErro(err.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <main className="pagina">
      <section className="card">
        <h1>Controle de Faturamento</h1>

        <p className="subtitulo">
          Dados salvos no Supabase.
        </p>

        <form className="formulario" onSubmit={salvarFaturamento}>
          <label>
            Descrição
            <input
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: Serviço Mensal"
              required
            />
          </label>

          <label>
            Valor (R$)
            <input
              type="number"
              step="0.01"
              min="0"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              required
            />
          </label>

          <label>
            Data
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              required
            />
          </label>

          <button type="submit" disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </form>

        {erro && (
          <p className="erro">
            {erro}
          </p>
        )}

        <div className="resumo">
          <strong>Total:</strong> {moeda.format(total)}
        </div>

        <h2>Lançamentos</h2>

        {carregando ? (
          <p>Carregando...</p>
        ) : faturamentos.length === 0 ? (
          <p>Nenhum lançamento encontrado.</p>
        ) : (
          <ul className="lista">
            {faturamentos.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.descricao}</strong>
                  <small>{item.data}</small>
                </div>

                <span>{moeda.format(Number(item.valor))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
